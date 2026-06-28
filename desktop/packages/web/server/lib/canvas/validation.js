const CANVAS_DOCUMENT_VERSION = 1
const CANVAS_DOCUMENT_ID = "main"
const MAX_CANVAS_ELEMENTS = 200
const MAX_TITLE_LENGTH = 120
const MAX_NOTE_TEXT_LENGTH = 5000
const MAX_LABEL_LENGTH = 160
const MIN_ELEMENT_SIZE = 24
const MAX_ELEMENT_SIZE = 2400
const MIN_COORDINATE = -100000
const MAX_COORDINATE = 100000

const NOTE_COLORS = new Set(["yellow", "blue", "green", "pink"])
const IMAGE_SLOT_ROLES = new Set(["reference", "generated-target"])

export class CanvasValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = "CanvasValidationError"
    this.statusCode = 400
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const clampNumber = (value, fallback, min, max) => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

const sanitizeString = (value, fallback, maxLength) => {
  const text = typeof value === "string" ? value : fallback
  return text.slice(0, maxLength)
}

const sanitizeBaseElement = (element, fallbackIndex) => {
  const id =
    typeof element.id === "string" && /^canvas-[a-zA-Z0-9_-]{4,80}$/.test(element.id)
      ? element.id
      : `canvas-${Date.now()}-${fallbackIndex}`

  return {
    id,
    x: clampNumber(element.x, 80 + fallbackIndex * 24, MIN_COORDINATE, MAX_COORDINATE),
    y: clampNumber(element.y, 80 + fallbackIndex * 24, MIN_COORDINATE, MAX_COORDINATE),
    width: clampNumber(element.width, 240, MIN_ELEMENT_SIZE, MAX_ELEMENT_SIZE),
    height: clampNumber(element.height, 160, MIN_ELEMENT_SIZE, MAX_ELEMENT_SIZE),
  }
}

const sanitizeElement = (element, index) => {
  if (!isObject(element)) {
    throw new CanvasValidationError(`Canvas element at index ${index} must be an object`)
  }

  const base = sanitizeBaseElement(element, index)
  if (element.type === "note") {
    return {
      ...base,
      type: "note",
      text: sanitizeString(element.text, "", MAX_NOTE_TEXT_LENGTH),
      color: NOTE_COLORS.has(element.color) ? element.color : "yellow",
    }
  }

  if (element.type === "image-slot") {
    return {
      ...base,
      type: "image-slot",
      label: sanitizeString(element.label, "Image slot", MAX_LABEL_LENGTH),
      role: IMAGE_SLOT_ROLES.has(element.role) ? element.role : "generated-target",
      assetId: typeof element.assetId === "string" && element.assetId.trim() ? element.assetId.trim() : null,
    }
  }

  throw new CanvasValidationError(`Unsupported canvas element type at index ${index}`)
}

export const createDefaultCanvasDocument = () => ({
  version: CANVAS_DOCUMENT_VERSION,
  id: CANVAS_DOCUMENT_ID,
  title: "Project Canvas",
  elements: [],
  updatedAt: new Date().toISOString(),
})

export const sanitizeCanvasDocument = (input) => {
  if (!isObject(input)) {
    throw new CanvasValidationError("Canvas document must be an object")
  }

  if (input.version !== CANVAS_DOCUMENT_VERSION) {
    throw new CanvasValidationError(`Unsupported canvas document version: ${String(input.version)}`)
  }

  const rawElements = Array.isArray(input.elements) ? input.elements : []
  if (rawElements.length > MAX_CANVAS_ELEMENTS) {
    throw new CanvasValidationError(`Canvas document cannot contain more than ${MAX_CANVAS_ELEMENTS} elements`)
  }

  const seenIds = new Set()
  const elements = rawElements.map((element, index) => {
    const sanitized = sanitizeElement(element, index)
    if (seenIds.has(sanitized.id)) {
      throw new CanvasValidationError(`Duplicate canvas element id: ${sanitized.id}`)
    }
    seenIds.add(sanitized.id)
    return sanitized
  })

  return {
    version: CANVAS_DOCUMENT_VERSION,
    id: CANVAS_DOCUMENT_ID,
    title: sanitizeString(input.title, "Project Canvas", MAX_TITLE_LENGTH).trim() || "Project Canvas",
    elements,
    updatedAt: new Date().toISOString(),
  }
}
