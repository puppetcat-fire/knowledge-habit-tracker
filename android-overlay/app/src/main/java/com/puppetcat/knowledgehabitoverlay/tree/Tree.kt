package com.puppetcat.knowledgehabitoverlay.tree

import android.content.Context
import org.json.JSONObject

data class TreeNode(
  val id: String,
  val title: String,
  val goal: String,
  val estMinutes: Int,
  val verifyHint: String,
  val ownership: String
)

data class TreeEdge(val from: String, val to: String, val type: String)

data class Tutorial(
  val id: String,
  val nodeId: String,
  val title: String,
  val method: String,
  val visibility: String,
  val license: String
)

data class Tree(
  val id: String,
  val name: String,
  val nodes: List<TreeNode>,
  val edges: List<TreeEdge>,
  val tutorials: List<Tutorial>
) {
  fun node(id: String): TreeNode? = nodes.firstOrNull { it.id == id }

  fun tutorialsFor(nodeId: String): List<Tutorial> = tutorials.filter { it.nodeId == nodeId }

  fun prereqsOf(nodeId: String): List<TreeNode> =
    edges.filter { it.to == nodeId && it.type == "prereq" }
      .mapNotNull { edge -> node(edge.from) }

  fun instancesOf(nodeId: String): List<TreeNode> =
    edges.filter { it.to == nodeId && it.type == "instance-of" }
      .mapNotNull { edge -> node(edge.from) }
}

object TreeLoader {
  fun load(context: Context, assetName: String = "k9-math.json"): Tree {
    val json = context.assets.open(assetName).bufferedReader().use { it.readText() }
    return parse(json)
  }

  fun parse(jsonText: String): Tree {
    val root = JSONObject(jsonText)
    val treeObj = root.getJSONObject("tree")
    val nodesArr = root.getJSONArray("nodes")
    val edgesArr = root.getJSONArray("edges")
    val tutorialsArr = root.getJSONArray("tutorials")

    val nodes = (0 until nodesArr.length()).map { i ->
      val n = nodesArr.getJSONObject(i)
      TreeNode(
        id = n.getString("id"),
        title = n.getString("title"),
        goal = n.getString("goal"),
        estMinutes = n.optInt("estMinutes", 10),
        verifyHint = n.optString("verifyHint", ""),
        ownership = n.optString("ownership", "group")
      )
    }
    val edges = (0 until edgesArr.length()).map { i ->
      val e = edgesArr.getJSONObject(i)
      TreeEdge(e.getString("from"), e.getString("to"), e.getString("type"))
    }
    val tutorials = (0 until tutorialsArr.length()).map { i ->
      val t = tutorialsArr.getJSONObject(i)
      Tutorial(
        id = t.getString("id"),
        nodeId = t.getString("nodeId"),
        title = t.getString("title"),
        method = t.getString("method"),
        visibility = t.optString("visibility", "folded"),
        license = t.optString("license", "open")
      )
    }
    return Tree(
      id = treeObj.getString("id"),
      name = treeObj.getString("name"),
      nodes = nodes,
      edges = edges,
      tutorials = tutorials
    )
  }
}
