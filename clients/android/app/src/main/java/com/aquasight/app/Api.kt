package com.aquasight.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class Api(private val base: String, private val tokenStore: TokenStore) {
    fun requestCode(email: String): JSONObject {
        return post("/api/v1/auth/request-code", JSONObject().put("email", email), auth = false)
    }

    fun verify(email: String, code: String): JSONObject {
        val data = post("/api/v1/auth/verify", JSONObject().put("email", email).put("code", code), auth = false)
        tokenStore.save(data.optString("token"))
        return data
    }

    fun me(): JSONObject = get("/api/v1/me")

    fun events(view: String): JSONObject = get("/api/v1/events?view=$view")

    fun event(id: String): JSONObject = get("/api/v1/events/" + java.net.URLEncoder.encode(id, "UTF-8"))

    fun saveFavorite(id: String, snapshot: JSONObject): JSONObject {
        return post("/api/v1/favorites", JSONObject().put("eventId", id).put("snapshot", snapshot))
    }

    fun mergeGuest(reads: JSONObject, favorites: org.json.JSONArray, prefs: JSONObject): JSONObject {
        return post(
            "/api/v1/sync/merge",
            JSONObject().put("reads", reads).put("favorites", favorites).put("prefs", prefs)
        )
    }

    fun logout() {
        post("/api/v1/auth/logout", JSONObject())
        tokenStore.clear()
    }

    private fun get(path: String): JSONObject = call("GET", path, null, true)

    private fun post(path: String, body: JSONObject, auth: Boolean = true): JSONObject =
        call("POST", path, body, auth)

    private fun call(method: String, path: String, body: JSONObject?, auth: Boolean): JSONObject {
        val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Content-Type", "application/json")
        val token = tokenStore.read()
        if (auth && token.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val text = (if (conn.responseCode >= 400) conn.errorStream else conn.inputStream)
            .bufferedReader().readText()
        if (conn.responseCode >= 400) throw ApiException(conn.responseCode, text)
        return JSONObject(text)
    }
}

class ApiException(val status: Int, message: String) : RuntimeException(message)

interface TokenStore {
    fun save(token: String)
    fun read(): String
    fun clear()
}
