(function exposeStateSync(root) {
  // 每个账号有独立的待保存副本。服务端版本用于拒绝旧窗口覆盖新记录。
  class StateSync {
    constructor(userId) {
      this.key = `knowledge-habit-pending:${userId}`;
      this.revision = null;
      this.pending = null;
      this.saving = null;
      this.blocked = false;
      this.timer = null;
      this.status = document.getElementById("save-status");
      this.message = document.getElementById("save-status-message");
      this.retry = document.getElementById("save-retry");
      this.exportButton = document.getElementById("save-export");
      this.reloadButton = document.getElementById("save-reload");
      if (this.retry) this.retry.onclick = () => { void this.flush(); };
      if (this.exportButton) this.exportButton.onclick = () => this.exportPending();
      if (this.reloadButton) this.reloadButton.onclick = () => {
        if (!root.confirm("读取账号已保存的版本？本页未保存记录请先导出备份。")) return;
        root.localStorage.removeItem(this.key);
        root.location.reload();
      };
    }

    show(message, problem = false) {
      if (!this.status) return;
      this.status.classList.remove("hidden");
      this.status.classList.toggle("save-problem", problem);
      this.message.textContent = message;
      this.retry.hidden = !this.pending || this.blocked;
      this.exportButton.hidden = !this.pending;
      this.reloadButton.hidden = !this.blocked;
    }

    async read() {
      const response = await root.fetch("/api/state", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data || data.ok !== true || typeof data.revision !== "string") {
        throw new Error((data && data.message) || "账号记录读取失败，请重试；原记录不会被覆盖。");
      }
      return data;
    }

    async load() {
      try {
        const raw = root.localStorage.getItem(this.key);
        this.pending = raw ? JSON.parse(raw) : null;
        const data = await this.read();
        this.revision = data.revision;
        if (this.pending) {
          if (this.pending.revision !== data.revision) {
            this.blocked = true;
            throw new Error("另一窗口已更新账号记录。请先导出本页未保存记录，再读取已保存版本。");
          }
          this.show("已恢复上次未保存的记录，正在重试保存。", true);
          return this.pending.state;
        }
        this.show("账号记录已读取");
        return data.state;
      } catch (error) {
        this.show(error.message || "读取失败，请稍后重试。", true);
        throw error;
      }
    }

    queue(state) {
      // 把快照连同其基线保存，重开页面仍能恢复；不使用其他账号的缓存。
      this.pending = { revision: this.revision, state: JSON.parse(JSON.stringify(state)) };
      try {
        root.localStorage.setItem(this.key, JSON.stringify(this.pending));
        this.show("记录已保留在此浏览器，等待写入账号。");
      } catch {
        this.show("浏览器空间不足，记录尚未安全保存。请保持页面打开并导出备份。", true);
      }
      if (this.blocked) {
        this.show("另一窗口已更新账号记录。本页改动已保留，请先导出，再读取已保存版本。", true);
        return;
      }
      root.clearTimeout(this.timer);
      this.timer = root.setTimeout(() => { void this.flush(); }, 400);
    }

    async flush() {
      root.clearTimeout(this.timer);
      if (this.saving) {
        await this.saving;
        if (this.pending && !this.blocked) return this.flush();
        return !this.pending;
      }
      if (!this.pending) return true;
      if (this.blocked) return false;
      const snapshot = this.pending;
      this.show("正在保存账号记录…");
      this.saving = (async () => {
        try {
          const response = await root.fetch("/api/state", {
            method: "PUT", credentials: "same-origin",
            headers: { "Content-Type": "application/json", "If-Match": this.revision },
            body: JSON.stringify(snapshot.state)
          });
          const data = await response.json();
          if (!response.ok || !data || data.ok !== true || typeof data.revision !== "string") {
            this.blocked = response.status === 409;
            throw new Error((data && data.message) || "保存失败，记录仍在此浏览器，请重试。");
          }
          this.revision = data.revision;
          if (this.pending === snapshot) {
            this.pending = null;
            root.localStorage.removeItem(this.key);
            this.show("已保存到本机账号");
          } else {
            this.pending.revision = this.revision;
            root.localStorage.setItem(this.key, JSON.stringify(this.pending));
          }
          return true;
        } catch (error) {
          this.show(error.message || "连接中断，记录仍在此浏览器，请重试。", true);
          return false;
        }
      })();
      const saved = await this.saving;
      this.saving = null;
      if (saved && this.pending) return this.flush();
      return saved;
    }

    async update(transform) {
      if (!(await this.flush())) return false;
      try {
        const data = await this.read();
        this.revision = data.revision;
        this.queue(transform(data.state));
        return await this.flush();
      } catch (error) {
        this.show(error.message || "读取失败，原记录不会被覆盖。", true);
        return false;
      }
    }

    exportPending() {
      if (!this.pending) return;
      const blob = new root.Blob([JSON.stringify(this.pending.state, null, 2)], { type: "application/json" });
      const url = root.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "点亮-未保存记录.json";
      link.click();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
    }
  }
  root.KHTStateSync = StateSync;
})(typeof window !== "undefined" ? window : globalThis);
