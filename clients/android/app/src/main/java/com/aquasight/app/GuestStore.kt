package com.aquasight.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class GuestStore(context: Context) {
    private val prefs = context.getSharedPreferences("aquasight.guest", Context.MODE_PRIVATE)

    fun items(): Map<String, JSONObject> {
        val out = mutableMapOf<String, JSONObject>()
        val raw = JSONObject(prefs.getString("data", "{}") ?: "{}")
        val items = raw.optJSONObject("items") ?: JSONObject()
        items.keys().forEach { id -> out[id] = items.getJSONObject(id) }
        return out
    }

    fun deletedIds(): List<String> {
        val raw = JSONObject(prefs.getString("data", "{}") ?: "{}")
        val deleted = raw.optJSONObject("deleted") ?: JSONObject()
        return deleted.keys().asSequence().toList()
    }

    fun reads(): JSONObject {
        val raw = JSONObject(prefs.getString("data", "{}") ?: "{}")
        return raw.optJSONObject("reads") ?: JSONObject()
    }

    fun prefs(): JSONObject {
        val raw = JSONObject(prefs.getString("data", "{}") ?: "{}")
        return raw.optJSONObject("prefs") ?: JSONObject()
    }

    fun save(id: String, snapshot: JSONObject) {
        mutate { data ->
            data.optJSONObject("items")?.put(id, snapshot) ?: data.put("items", JSONObject().put(id, snapshot))
            data.optJSONObject("deleted")?.remove(id)
        }
    }

    fun remove(id: String) {
        mutate { data ->
            data.optJSONObject("items")?.remove(id)
            val deleted = data.optJSONObject("deleted") ?: JSONObject().also { data.put("deleted", it) }
            deleted.put(id, true)
        }
    }

    fun markRead(id: String) {
        mutate { data ->
            val reads = data.optJSONObject("reads") ?: JSONObject().also { data.put("reads", it) }
            if (!reads.has(id)) reads.put(id, java.time.Instant.now().toString())
        }
    }

    fun mergeBody(): JSONObject {
        val favorites = JSONArray()
        for (id in deletedIds()) {
            favorites.put(JSONObject().put("id", id).put("deleted", true))
        }
        val seen = deletedIds().toMutableSet()
        for ((id, snap) in items()) {
            if (seen.add(id)) favorites.put(JSONObject().put("id", id).put("snapshot", snap))
        }
        return JSONObject()
            .put("reads", reads())
            .put("prefs", prefs())
            .put("favorites", favorites)
    }

    private fun mutate(block: (JSONObject) -> Unit) {
        val data = JSONObject(prefs.getString("data", "{}") ?: "{}")
        if (!data.has("items")) data.put("items", JSONObject())
        if (!data.has("deleted")) data.put("deleted", JSONObject())
        if (!data.has("reads")) data.put("reads", JSONObject())
        if (!data.has("prefs")) data.put("prefs", JSONObject())
        block(data)
        prefs.edit().putString("data", data.toString()).apply()
    }
}
