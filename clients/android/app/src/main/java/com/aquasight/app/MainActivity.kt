package com.aquasight.app

import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Kotlin 原生阅读壳。不用 Flutter。
 * 真机验收：登录、离线收藏、进程被杀后恢复、通知打开 #/event/:id。
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val deepLink = intent?.data?.fragment
        if (deepLink != null && deepLink.startsWith("/event/")) {
            Toast.makeText(this, "打开新闻 " + deepLink.removePrefix("/event/"), Toast.LENGTH_SHORT).show()
        }
    }
}
