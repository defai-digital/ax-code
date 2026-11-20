import { expect, test } from "vitest"
import { MouseParser } from "../src/lib/parse.mouse.js"

const seq = (value: string): Buffer => Buffer.from(value, "latin1")

test("SGR release untracks only the released button, preserving other drags", () => {
  const parser = new MouseParser()

  expect(parser.parseMouseEvent(seq("\x1b[<0;10;5M"))?.type).toBe("down") // left down
  expect(parser.parseMouseEvent(seq("\x1b[<2;10;5M"))?.type).toBe("down") // right down
  expect(parser.parseMouseEvent(seq("\x1b[<2;10;5m"))?.type).toBe("up") // right up

  // Left button is still held: motion with the left button must stay a drag.
  const motion = parser.parseMouseEvent(seq("\x1b[<32;11;5M"))
  expect(motion?.type).toBe("drag")
})

test("SGR releasing the last held button ends the drag", () => {
  const parser = new MouseParser()

  parser.parseMouseEvent(seq("\x1b[<0;10;5M")) // left down
  parser.parseMouseEvent(seq("\x1b[<0;10;5m")) // left up

  const motion = parser.parseMouseEvent(seq("\x1b[<32;11;5M"))
  expect(motion?.type).toBe("move")
})

test("SGR button-agnostic motion reports the codified button values per encoding", () => {
  const parser = new MouseParser()

  // 35 = motion (32) + "no button" (3), e.g. hover with any-button tracking.
  // SGR maps the no-button code to 0 (established stdin-parser contract).
  const hover = parser.parseMouseEvent(seq("\x1b[<35;10;5M"))
  expect(hover?.type).toBe("move")
  expect(hover?.button).toBe(0)

  // X10/basic encoding of the same event: ESC [ M <67> <x+33> <y+33>.
  const basicHover = parser.parseMouseEvent(seq("\x1b[MC" + String.fromCharCode(33 + 9) + String.fromCharCode(33 + 4)))
  expect(basicHover?.type).toBe("move")
  expect(basicHover?.button).toBe(-1)
  expect(hover?.x).toBe(basicHover?.x)
  expect(hover?.y).toBe(basicHover?.y)
})

test("SGR button-agnostic release clears the pressed set so later motion is not a drag", () => {
  const parser = new MouseParser()

  expect(parser.parseMouseEvent(seq("\x1b[<0;10;5M"))?.type).toBe("down") // left down
  expect(parser.parseMouseEvent(seq("\x1b[<2;10;5M"))?.type).toBe("down") // right down

  // Mode-1000 terminals report releases with button code 3 ("no button") instead
  // of the released button. The pressed set must be cleared, not left stale.
  expect(parser.parseMouseEvent(seq("\x1b[<3;10;5m"))?.type).toBe("up")

  const motion = parser.parseMouseEvent(seq("\x1b[<32;11;5M"))
  expect(motion?.type).toBe("move")
})

test("X10 button-held motion is reported as a drag", () => {
  const parser = new MouseParser()
  const basic = (buttonByte: number, x: number, y: number): Buffer =>
    seq("\x1b[M" + String.fromCharCode(buttonByte + 32) + String.fromCharCode(x + 33) + String.fromCharCode(y + 33))

  expect(parser.parseMouseEvent(basic(0, 1, 1))?.type).toBe("down")

  // 32 = motion, low bits 0 = left button still held.
  const drag = parser.parseMouseEvent(basic(32, 4, 2))
  expect(drag?.type).toBe("drag")
  expect(drag?.button).toBe(0)
  expect(drag?.x).toBe(4)
  expect(drag?.y).toBe(2)

  // 35 = motion with button code 3 (no button held).
  const hover = parser.parseMouseEvent(basic(35, 4, 2))
  expect(hover?.type).toBe("move")
  expect(hover?.button).toBe(-1)
})

test("SGR wheel release is not a button up and does not end an active drag", () => {
  const parser = new MouseParser()

  expect(parser.parseMouseEvent(seq("\x1b[<0;10;5M"))?.type).toBe("down") // left down
  // 64 = wheel-up; some terminals pair each wheel press with an `m` release.
  expect(parser.parseMouseEvent(seq("\x1b[<64;10;5m"))).toBeNull()

  // The left button is still held, so motion must remain a drag.
  expect(parser.parseMouseEvent(seq("\x1b[<32;11;5M"))?.type).toBe("drag")
})

test("SGR wheel-down release reports no event", () => {
  const parser = new MouseParser()
  expect(parser.parseMouseEvent(seq("\x1b[<65;10;5m"))).toBeNull()
})

test("SGR wheel press is a scroll event, not a button down", () => {
  const parser = new MouseParser()
  const event = parser.parseMouseEvent(seq("\x1b[<64;10;5M"))
  expect(event?.type).toBe("scroll")
  expect(event?.scroll?.direction).toBe("up")
})

test("parseAllMouseEvents skips wheel releases but keeps presses and motion", () => {
  const parser = new MouseParser()
  const events = parser.parseAllMouseEvents(seq("\x1b[<64;10;5M\x1b[<64;10;5m\x1b[<32;11;5M"))

  expect(events).toHaveLength(2)
  expect(events[0].type).toBe("scroll")
  expect(events[0].scroll?.direction).toBe("up")
  // A wheel press holds no button, so the following motion is a move, not a drag.
  expect(events[1].type).toBe("move")
})
