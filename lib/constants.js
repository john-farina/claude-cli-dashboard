// lib/constants.js — Shared constants for server-side code
module.exports = {
  STATUS: {
    WORKING: "working",
    IDLE: "idle",
    WAITING: "waiting",
    ASKING: "asking",
  },
  MSG_TYPE: {
    OUTPUT: "output",
    SESSIONS: "sessions",
    TOKEN_USAGE: "token-usage",
    TODO_UPDATE: "todo-update",
    FAVORITES_UPDATE: "favorites-update",
    SHELL_INFO: "shell-info",
    STATUS: "status",
    PROMPT_TYPE: "prompt-type",
    INPUT_SYNC: "input-sync",
    UPDATE_AVAILABLE: "update-available",
    FILE_OVERLAPS: "file-overlaps",
    SHELL_UNAVAILABLE: "shell-unavailable",
  },
  PROMPT: {
    PERMISSION: "permission",
    YESNO: "yesno",
    ENTER: "enter",
    QUESTION: "question",
  },
};
