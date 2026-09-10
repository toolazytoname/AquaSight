package com.aquasight.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class Api(private val base: String, private val tokenStore: SessionStore) {
    fun requestCode(email: String): JSONObject {
        return post("/api/v1/auth/request-code", JSONObject().put("email", email), auth = false)
    }

    fun verify(email: String, code: String): JSONObject {
        val data = post("/api/v1/auth/verify", JSONObject().put("email", email).put("code", code), auth = false)
        val token = data.optString("token")
        if (token.isNotBlank()) tokenStore.save(token)
        return data
    }

    fun events(view: String, q: String = ""): JSONObject {
        val query = if (q.isBlank()) "" else "&q=" + java.net.URLEncoder.encode(q, "UTF-8")
        return get("/api/v1/events?view=$view$query")
    }

    fun event(id: String): JSONObject {
        return get("/api/v1/events/" + java.net.URLEncoder.encode(id, "UTF-8"))
    }

    fun digest(): JSONObject = get("/api/v1/digest")

    fun saveFavorite(id: String, snapshot: JSONObject): JSONObject {
        return post("/api/v1/favorites", JSONObject().put("eventId", id).put("snapshot", snapshot))
    }

    fun deleteFavorite(id: String): JSONObject {
        return call("DELETE", "/api/v1/favorites/" + java.net.URLEncoder.encode(id, "UTF-8"), null, true)
    }

    fun mergeGuest(body: JSONObject): JSONObject = post("/api/v1/sync/merge", body)

    fun logout() {
        try {
            post("/api/v1/auth/logout", JSONObject())
        } finally {
            tokenStore.clear()
        }
    }

    fun loggedIn(): Boolean = tokenStore.read().isNotBlank()

    private fun get(path: String): JSONObject = call("GET", path, null, true)

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject =
        call("POST", path, body, auth)

    private fun call(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject {
        val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.requestMethod = method
        conn.setRequestProperty("Accept", "application/json")
        val token = tokenStore.read()
        if (auth && token.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val stream = if (conn.responseCode >= 400) conn.errorStream else conn.inputStream
        val text = stream?.bufferedReader()?.readText() ?: "{}"
        if (conn.responseCode >= 400) throw ApiException(conn.responseCode, text)
        return JSONObject(text)
    }
}

class ApiException(val status: Int, message: String) : RuntimeException(message)

fun JSONObject.items(): List<JSONObject> {
    val arr: JSONArray = optJSONArray("items") ?: return emptyList()
    return (0 until arr.length()).map { arr.getJSONObject(it) }
}

fun JSONObject.displayTitle(): String {
    val zh = optString("titleZh")
    if (zh.isNotBlank()) return zh
    return optString("title")
}

fun JSONObject.overview(): String {
    val zh = optString("overviewZh")
    if (zh.isNotBlank()) return zh
    return optString("summary")
}
