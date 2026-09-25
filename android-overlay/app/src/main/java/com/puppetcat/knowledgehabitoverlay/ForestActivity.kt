package com.puppetcat.knowledgehabitoverlay

import android.os.Bundle
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.button.MaterialButton
import com.puppetcat.knowledgehabitoverlay.forest.ForestStore
import com.puppetcat.knowledgehabitoverlay.tree.TreeLoader
import com.puppetcat.knowledgehabitoverlay.tree.TreeNode

class ForestActivity : AppCompatActivity() {
  private lateinit var store: ForestStore

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_forest)
    store = ForestStore(this)
    render()
  }

  private fun render() {
    val container = findViewById<LinearLayout>(R.id.nodeList)
    container.removeAllViews()
    val tree = TreeLoader.load(this)
    val lit = store.litNodeIds()

    tree.nodes.forEach { node ->
      container.addView(
        MaterialButton(this).apply {
          text = buildString {
            append(if (lit.contains(node.id)) "● " else "○ ")
            append(node.title)
            append("  (${node.estMinutes}min)")
          }
          isAllCaps = false
          setOnClickListener { showNode(tree, node) }
        }
      )
    }
  }

  private fun showNode(tree: com.puppetcat.knowledgehabitoverlay.tree.Tree, node: TreeNode) {
    val tutorials = tree.tutorialsFor(node.id)
    val prereqs = tree.prereqsOf(node.id)
    val lit = store.isLit(node.id)

    val message = buildString {
      append("目标：").append(node.goal).append('\n').append('\n')
      append("自证提示：").append(node.verifyHint).append('\n')
      if (prereqs.isNotEmpty()) {
        append('\n').append("推荐前置：").append(prereqs.joinToString("、") { it.title })
      }
      if (tutorials.isNotEmpty()) {
        append('\n').append('\n').append("教程（默认折叠，点开才展开）：")
        tutorials.forEach { t -> append('\n').append("  ▸ ").append(t.title) }
      }
      append('\n').append('\n').append("状态：").append(if (lit) "已点亮" else "未点亮")
    }

    AlertDialog.Builder(this)
      .setTitle(node.title)
      .setMessage(message)
      .setPositiveButton(if (lit) "复习复点" else "点亮（自证）") { _, _ ->
        store.addLightUp(node.id)
        render()
      }
      .setNegativeButton("关闭", null)
      .show()
  }
}
