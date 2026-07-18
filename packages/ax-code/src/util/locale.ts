export namespace Locale {
  export function titlecase(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase())
  }

  export function time(input: number): string {
    const date = new Date(input)
    return date.toLocaleTimeString(undefined, { timeStyle: "short" })
  }

  export function datetime(input: number): string {
    const date = new Date(input)
    const localTime = time(input)
    const localDate = date.toLocaleDateString()
    return `${localTime} · ${localDate}`
  }

  export function todayTimeOrDateTime(input: number): string {
    const date = new Date(input)
    const now = new Date()
    const isToday =
      date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()

    if (isToday) {
      return time(input)
    } else {
      return datetime(input)
    }
  }

  export function number(num: number): string {
    // Promote at 999_950: (n/1000).toFixed(1) would otherwise emit "1000.0K".
    if (num >= 999_950) {
      return (num / 1_000_000).toFixed(1) + "M"
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    return num.toString()
  }

  export function duration(input: number) {
    if (input < 1000) {
      return `${input}ms`
    }
    const totalSeconds = Math.round(input / 1000)
    if (totalSeconds < 60) {
      return `${(input / 1000).toFixed(1)}s`
    }
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return `${minutes}m ${seconds}s`
    }
    const totalMinutes = Math.round(input / 60000)
    if (totalMinutes < 1440) {
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      return `${hours}h ${minutes}m`
    }
    const totalHours = Math.round(input / 3600000)
    const days = Math.floor(totalHours / 24)
    const hours = totalHours % 24
    return `${days}d ${hours}h`
  }

  export function truncate(str: string, len: number): string {
    if (str.length <= len) return str
    return str.slice(0, len - 1) + "…"
  }

  export function truncateMiddle(str: string, maxLength: number = 35): string {
    if (str.length <= maxLength) return str

    const ellipsis = "…"
    const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
    const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

    // slice(-0) returns the entire string, not empty — guard against it
    return str.slice(0, keepStart) + ellipsis + (keepEnd > 0 ? str.slice(-keepEnd) : "")
  }

  export function pluralize(count: number, singular: string, plural: string): string {
    const template = count === 1 ? singular : plural
    return template.replace("{}", count.toString())
  }
}
