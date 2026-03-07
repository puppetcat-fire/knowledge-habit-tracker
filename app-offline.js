.length === 0) {
    habitPickerList.innerHTML = `<div class="empty-state">未找到习惯</div>`;
    return;
  }
  
  habitPickerList.innerHTML = filteredHabits
    .map((habit) => {
      const isSelected = state.timer.selectedHabitId === habit.id;
      return `
        <div class="habit-picker-item ${isSelected ? "selected" : ""}" data-habit-id="${habit.id}">
          <div class="habit-picker-item-name">${escapeHtml(habit.name)}</div>
          <div class="habit-picker-item-meta">${habit.targetDays} 天目标</div>
        </div>
      `;
    })
    .join("");
  
  // 添加事件监听
  habitPickerList.querySelectorAll(".habit-picker-item").forEach((item) => {
    item.addEventListener("click", () => {
      const habitId = item.getAttribute("data-habit-id");
      const habit = allHabits.find(h => h.id === habitId);
      if (habit) {
        state.timer.selectedHabitId = habit.id;
        state.timer.selectedHabitName = habit.name;
        state.timer.predictedAction = habit.name;
        timerPredictionInput.value = habit.name;
        timerRecurringLogInput.value = habit.recurringLog || "";
        saveState();
        updateTimerHabitLabel();
        habitPicker.classList.add("hidden");
      }
    });
  });
}

function updateTimerDisplay() {
  if (!timerDisplay) return;
  
  let displayMs = state.timer.elapsedMs;
  if (state.timer.running && state.timer.startedAt) {
    displayMs += Date.now() - new Date(state.timer.startedAt).getTime();
  }
  
  const hours = Math.floor(displayMs / 3600000);
  const minutes = Math.floor((displayMs % 3600000) / 60000);
  const seconds = Math.floor((displayMs % 60000) / 1000);
  
  timerDisplay.textContent = 
    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  if (state.timer.running) {
    requestAnimationFrame(updateTimerDisplay);
  }
}

function updateTimerHabitLabel() {
  if (!timerHabitLabel) return;
  
  if (state.timer.selectedHabitId) {
    timerHabitLabel.textContent = state.timer.selectedHabitName;
    timerHabitLabel.classList.add("success");
  } else {
    timerHabitLabel.textContent = "未选择";
    timerHabitLabel.classList.remove("success");
  }
}

function startTimer() {
  updateTimerDisplay();
}

function showReport(report) {
  if (battleReport) {
    battleReport.textContent = report;
    battleReport.classList.remove("hidden");
  }
  if (timerReport) {
    timerReport.textContent = report;
    timerReport.classList.remove("hidden");
  }
}

function editHabitRecord(habit, source) {
  const nameInput = prompt("习惯名称", habit.name);
  if (nameInput === null) {
    return;
  }
  const name = nameInput.trim();
  if (!name) {
    return;
  }
  const daysInput = prompt("养成周期（天）", String(habit.targetDays));
  if (daysInput === null) {
    return;
  }
  const targetDays = Number(daysInput);
  if (Number.isNaN(targetDays) || targetDays < 60 || targetDays > 255) {
    alert("养成周期需在 60-255 天");
    return;
  }
  const recurringInput = prompt("重复日志", habit.recurringLog || "");
  if (recurringInput === null) {
    return;
  }

  habit.name = name;
  habit.targetDays = targetDays;
  habit.recurringLog = recurringInput;
  saveState();
  
  if (source === "current") {
    renderHabitSection();
  } else if (source === "history") {
    renderHabitHistory();
  }
}

// ==================== 启动应用 ====================

// 等待DOM加载完成
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

// 导出全局函数（用于调试）
window.KHT = {
  state,
  saveState,
  exportAllData,
  importData: showImportDialog,
  clearAllData,
  getCachedBugs,
  version: "1.0-offline"
};