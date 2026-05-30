export function renderUserName(target: { textContent: string | null }, value: string) {
  // ax-workflow-seed: text-content-xss-rejected
  target.textContent = value
}
