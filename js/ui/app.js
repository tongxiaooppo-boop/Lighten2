// 輕盈計畫 (Lighten Plan) — 進入點：初始化各分頁。
// module script 在 HTML 解析完才執行，不需要等 DOMContentLoaded。

import { initTabs } from "./tabs.js";
import { initProfileTab } from "./tab-profile.js";
import { initTodayTab } from "./tab-today.js";
import { initExerciseTab } from "./tab-exercise.js";
import { initWeekTab } from "./tab-week.js";

initProfileTab();
initTodayTab();
initExerciseTab();
initWeekTab();
initTabs();
