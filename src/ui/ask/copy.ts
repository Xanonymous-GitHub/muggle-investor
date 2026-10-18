// Every user-facing string of the Ask screen (Traditional Chinese). Draft wording, for review.

export const ASK_COPY = {
  title: "問問看",
  loading: "載入中",
  gate: {
    checkFailed: "連不上伺服器，請稍後再試",
    retry: "重試",
  },
  invite: {
    heading: "輸入邀請碼",
    intro: "問問看需要邀請碼才能使用。",
    label: "邀請碼",
    submit: "進入",
    sending: "確認中",
    invalid: "邀請碼不正確",
    throttled: "試太多次了，請稍後再試",
    error: "連不上伺服器，請稍後再試",
  },
  signOut: {
    button: "登出問問看",
    hint: "登出後需要重新輸入邀請碼；這個裝置上的對話與資料不會被清除。",
    done: "已登出",
    failed: "登出失敗，請稍後再試",
  },
} as const;
