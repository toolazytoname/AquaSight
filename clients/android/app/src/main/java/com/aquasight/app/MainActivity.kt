package com.aquasight.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var api: Api
    private lateinit var guest: GuestStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = SessionStore(this)
        api = Api("https://aquasight.lazywc.workers.dev", session)
        guest = GuestStore(this)
        val initialEvent = eventIdFrom(intent)
        setContent {
            AquaTheme {
                AquaApp(api, guest, initialEvent)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}

fun eventIdFrom(intent: Intent?): String {
    // https://<host>/#/event/<id>
    val uri: Uri = intent?.data ?: return ""
    val fragment = uri.fragment ?: ""
    if (fragment.startsWith("/event/")) return fragment.removePrefix("/event/")
    val path = uri.path ?: ""
    if (path.contains("/event/")) return path.substringAfter("/event/")
    return ""
}

private val Ink = Color(0xFF25392E)
private val Green = Color(0xFF216347)
private val Soft = Color(0xFFE6EFE7)
private val Bg = Color(0xFFF4F6F3)
private val Muted = Color(0xFF637368)
private val Card = Color(0xFFFFFFFF)

@Composable
fun AquaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Green,
            background = Bg,
            surface = Card,
            onPrimary = Color.White,
            onBackground = Ink,
            onSurface = Ink
        ),
        content = content
    )
}

private val Tabs = listOf("featured" to "精选", "latest" to "最新", "digest" to "早报", "saved" to "收藏")

@Composable
fun AquaApp(api: Api, guest: GuestStore, initialEvent: String) {
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf("featured") }
    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf(listOf<JSONObject>()) }
    var empty by remember { mutableStateOf("正在打开…") }
    var detail by remember { mutableStateOf<JSONObject?>(null) }
    var notice by remember { mutableStateOf("") }
    var showLogin by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var pendingEvent by remember { mutableStateOf(initialEvent) }

    fun load() {
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) {
                    when (view) {
                        "saved" -> null
                        "digest" -> api.digest()
                        else -> api.events(view, query)
                    }
                }
                items = if (view == "saved") {
                    guest.items().values.toList()
                } else if (view == "digest") {
                    val digest = data?.optJSONObject("digest")
                    val arr = digest?.optJSONArray("items")
                    if (arr == null) emptyList()
                    else (0 until arr.length()).map { arr.getJSONObject(it) }
                } else {
                    data?.items() ?: emptyList()
                }
                empty = when {
                    items.isNotEmpty() -> ""
                    view == "saved" -> "还没有收藏，遇到想留着读的新闻可以点收藏。"
                    view == "digest" -> "今天的早报尚未生成。"
                    query.isNotBlank() -> "没有符合条件的内容，请调整或清除筛选。"
                    else -> "暂时没有新闻，稍后刷新再看看。"
                }
                notice = ""
            } catch (_: Exception) {
                if (view == "saved") {
                    items = guest.items().values.toList()
                    empty = if (items.isEmpty()) "还没有收藏，遇到想留着读的新闻可以点收藏。" else ""
                    notice = ""
                } else {
                    notice = if (items.isEmpty()) "暂时没有新闻，稍后刷新再看看。" else ""
                }
            }
        }
    }

    fun openEvent(id: String) {
        if (id.isBlank()) return
        scope.launch {
            val local = guest.items()[id] ?: items.find { it.optString("id") == id }
            try {
                val data = withContext(Dispatchers.IO) { api.event(id) }
                detail = data.optJSONObject("item") ?: local
            } catch (_: Exception) {
                detail = local
                if (detail == null) notice = "这条还不在本机收藏里。"
            }
            guest.markRead(id)
        }
    }

    fun toggleSave(item: JSONObject) {
        val id = item.optString("id")
        if (id.isBlank()) return
        val saved = guest.items().containsKey(id)
        if (saved) guest.remove(id) else guest.save(id, item)
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (saved) api.deleteFavorite(id) else api.saveFavorite(id, item)
                }
                notice = if (saved) "已取消收藏" else "已收藏"
            } catch (_: Exception) {
                notice = if (saved) "已在本机取消，待同步" else "已收藏到本机"
            }
            if (view == "saved") load()
        }
    }

    androidx.compose.runtime.LaunchedEffect(view, query) { load() }
    androidx.compose.runtime.LaunchedEffect(pendingEvent) {
        if (pendingEvent.isNotBlank()) {
            openEvent(pendingEvent)
            pendingEvent = ""
        }
    }

    Surface(Modifier.fillMaxSize().background(Bg), color = Bg) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(20.dp, 18.dp, 20.dp, 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text("AQUASIGHT", color = Green, fontSize = 9.sp, letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold)
                    Text("鸭先知", color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                }
                Row {
                    TextButton(onClick = { showLogin = true }, modifier = Modifier.heightIn(min = 44.dp)) { Text("登录") }
                    TextButton(onClick = { showSettings = true }, modifier = Modifier.heightIn(min = 44.dp)) { Text("设置") }
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).heightIn(min = 44.dp),
                placeholder = { Text("搜索标题或概述") },
                singleLine = true,
                shape = RoundedCornerShape(999.dp)
            )
            if (notice.isNotBlank()) {
                Text(notice, color = Muted, fontSize = 13.sp, modifier = Modifier.padding(20.dp, 8.dp, 20.dp, 0.dp))
            }
            if (detail != null) {
                val item = detail!!
                val id = item.optString("id")
                val saved = guest.items().containsKey(id)
                Column(Modifier.weight(1f).padding(20.dp)) {
                    TextButton(onClick = { detail = null }, modifier = Modifier.heightIn(min = 44.dp)) { Text("返回") }
                    Text(item.displayTitle(), color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
                    Text(item.overview().ifBlank { "暂无摘要" }, color = Muted, fontSize = 15.sp, modifier = Modifier.padding(top = 12.dp), lineHeight = 24.sp)
                    Button(
                        onClick = { toggleSave(item) },
                        modifier = Modifier.padding(top = 20.dp).heightIn(min = 44.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Soft, contentColor = Green)
                    ) { Text(if (saved) "取消收藏" else "收藏") }
                }
            } else {
                LazyColumn(Modifier.weight(1f).padding(horizontal = 20.dp)) {
                    if (items.isEmpty()) {
                        item {
                            Column(Modifier.fillMaxWidth().padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(empty.substringBefore("，").ifBlank { "暂时没有新闻" }, color = Ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                                Text(empty, color = Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                            }
                        }
                    }
                    items(items, key = { it.optString("id") }) { item ->
                        val id = item.optString("id")
                        val saved = guest.items().containsKey(id)
                        Column(
                            Modifier.fillMaxWidth().clickable { openEvent(id) }.padding(vertical = 16.dp)
                        ) {
                            Text(item.displayTitle(), color = Ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            val ov = item.overview()
                            if (ov.isNotBlank()) Text(ov, color = Muted, fontSize = 14.sp, maxLines = 3, modifier = Modifier.padding(top = 6.dp))
                            TextButton(onClick = { toggleSave(item) }, modifier = Modifier.heightIn(min = 44.dp)) {
                                Text(if (saved) "取消收藏" else "收藏", color = Green)
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(Card).padding(4.dp, 6.dp)) {
                Tabs.forEach { (id, label) ->
                    val current = view == id && detail == null
                    Text(
                        label,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp)
                            .clickable {
                                detail = null
                                view = id
                            }
                            .background(if (current) Soft else Color.Transparent, RoundedCornerShape(8.dp))
                            .padding(vertical = 12.dp),
                        color = if (current) Green else Ink,
                        fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 14.sp
                    )
                }
            }
        }
        if (showLogin) {
            Overlay {
                Text("邮箱登录", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text("验证码登录。未登录也可阅读，收藏先留在这台设备上。", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                OutlinedTextField(email, { email = it }, label = { Text("邮箱") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                Button(onClick = {
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { api.requestCode(email) }
                            notice = "已提交。验证码 10 分钟内有效。"
                        } catch (_: Exception) {
                            notice = "暂时发不出验证码"
                        }
                    }
                }, modifier = Modifier.padding(top = 8.dp).heightIn(min = 44.dp)) { Text("发送验证码") }
                OutlinedTextField(code, { code = it }, label = { Text("验证码") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
                Button(onClick = {
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                api.verify(email, code)
                                api.mergeGuest(guest.mergeBody())
                            }
                            showLogin = false
                            notice = "已登录，本机收藏已合并"
                            load()
                        } catch (_: Exception) {
                            notice = "验证码无效或已过期"
                        }
                    }
                }, modifier = Modifier.padding(top = 8.dp).heightIn(min = 44.dp)) { Text("登录") }
                TextButton(onClick = { showLogin = false }, modifier = Modifier.heightIn(min = 44.dp)) { Text("关闭") }
            }
        }
        if (showSettings) {
            Overlay {
                Text("设置", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text("未登录时收藏保存在这台设备上。登录后会合并到账户，删除过的收藏不会复活。", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                TextButton(onClick = {
                    scope.launch {
                        withContext(Dispatchers.IO) { runCatching { api.logout() } }
                        notice = "已退出"
                        showSettings = false
                    }
                }, modifier = Modifier.heightIn(min = 44.dp)) { Text("退出当前设备") }
                TextButton(onClick = { showSettings = false }, modifier = Modifier.heightIn(min = 44.dp)) { Text("关闭") }
            }
        }
    }
}

@Composable
private fun Overlay(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color(0x660E1C14)).clickable(enabled = false) {},
        verticalArrangement = Arrangement.Top,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Column(
            Modifier
                .padding(16.dp, 48.dp)
                .background(Card, RoundedCornerShape(16.dp))
                .padding(24.dp)
                .fillMaxWidth()
        ) { content() }
    }
}
