export const SDK_VERSION = "0.1.0";
export const CHROME_CLEAR_SEQUENCE = '\x1b]771;{"clear":true}\x07';
/** Conservative host identity check, not a graphics probe or acknowledgement. */
export function detectCapabilities(env, isTTY) {
    const nested = [
        "SSH_CONNECTION",
        "SSH_CLIENT",
        "SSH_TTY",
        "MOSH_CONNECTION",
        "TMUX",
        "TMUX_PANE",
        "STY",
        "ZELLIJ",
    ].some((key) => Boolean(env[key]?.trim()));
    const compatible = /^(?:dumb|linux|vt100)$|^(?:screen|tmux)(?:[.-]|$)/.test(env["TERM"] ?? "");
    const title = isTTY && !nested && !compatible;
    return Object.freeze({
        title,
        chrome: title && env["TERM_PROGRAM"] === "Akitty",
    });
}
function text(value, replace) {
    if (typeof value !== "string")
        throw new RangeError("text must be a string");
    let result = "";
    let count = 0;
    for (const char of value) {
        if (/[\x00-\x1f\x7f-\x9f]/.test(char)) {
            if (!replace)
                continue;
            result += replace;
        }
        else
            result += char;
        if (++count === 128)
            break;
    }
    return result;
}
function fields(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new RangeError("expected an object");
    if (Object.keys(value).some((key) => !allowed.includes(key)))
        throw new RangeError("unknown field");
}
function dimension(value) {
    if (!Number.isInteger(value) || value < 1 || value > 32)
        throw new RangeError("sprite edges must be 1..32");
}
function validateSprite(sprite) {
    fields(sprite, ["w", "h", "frames"]);
    dimension(sprite.w);
    dimension(sprite.h);
    if (!Array.isArray(sprite.frames) ||
        sprite.frames.length < 1 ||
        sprite.frames.length > 4) {
        throw new RangeError("sprite needs 1..4 frames");
    }
    const length = sprite.w * sprite.h * 4;
    const frames = sprite.frames.map((frame) => {
        if (typeof frame !== "string" ||
            frame.length !== 4 * Math.ceil(length / 3)) {
            throw new RangeError("sprite frame does not match dimensions");
        }
        let decoded;
        try {
            decoded = atob(frame);
        }
        catch {
            throw new RangeError("sprite frame must be standard base64 RGBA");
        }
        if (decoded.length !== length || btoa(decoded) !== frame)
            throw new RangeError("sprite frame must be standard base64 RGBA");
        return frame;
    });
    return Object.freeze({
        w: sprite.w,
        h: sprite.h,
        frames: Object.freeze(frames),
    });
}
/** Copy bounded RGBA8 frames into an immutable inline sprite; no native or image decoder dependency. */
export function createSprite(w, h, frames) {
    dimension(w);
    dimension(h);
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > 4)
        throw new RangeError("sprite needs 1..4 frames");
    return validateSprite({
        w,
        h,
        frames: frames.map((frame) => {
            if (!(frame instanceof Uint8Array) || frame.length !== w * h * 4)
                throw new RangeError("sprite frame does not match dimensions");
            return btoa(String.fromCharCode(...frame));
        }),
    });
}
/** OSC 2 followed by OSC 1 preserves explicit tab titles on Apple Terminal. */
export function titleSequence(title) {
    const clean = text(title, " ");
    return `\x1b]2;${clean}\x07\x1b]1;${clean}\x07`;
}
function normalize(patch, previous = {}) {
    fields(patch, ["status", "mark", "progress", "sprite"]);
    const next = { ...previous };
    for (const key of ["status", "mark", "progress", "sprite"]) {
        if (patch[key] === null)
            delete next[key];
    }
    if (patch.status != null) {
        fields(patch.status, ["text", "tone", "expires"]);
        const { tone, expires } = patch.status;
        if (!["info", "warn", "error"].includes(tone))
            throw new RangeError("invalid status tone");
        if (expires !== undefined &&
            (!Number.isSafeInteger(expires) || expires < 0))
            throw new RangeError("expires must be Unix milliseconds");
        next.status = Object.freeze({
            text: text(patch.status.text, ""),
            tone,
            ...(expires === undefined ? {} : { expires }),
        });
    }
    if (patch.mark != null) {
        const mark = patch.mark;
        if (!(typeof mark === "number"
            ? Number.isInteger(mark) && mark >= 0 && mark <= 3
            : ["idle", "busy", "error"].includes(mark))) {
            throw new RangeError("invalid chrome mark");
        }
        next.mark = mark;
    }
    if (patch.progress != null) {
        const progress = patch.progress;
        if (progress !== "indeterminate" &&
            (typeof progress !== "number" ||
                !Number.isFinite(progress) ||
                progress < 0 ||
                progress > 1)) {
            throw new RangeError("progress must be 0..1 or indeterminate");
        }
        next.progress = progress;
    }
    if (patch.sprite != null)
        next.sprite = validateSprite(patch.sprite);
    return Object.freeze(next);
}
/** Encode a full replacement document. Use the client for field-preserving updates. */
export function chromeSequence(document) {
    const clean = normalize(document);
    if (!Object.keys(clean).length)
        return CHROME_CLEAR_SEQUENCE;
    return `\x1b]771;${JSON.stringify(clean)}\x07`;
}
function schedule(tick, intervalMs) {
    const timer = setInterval(tick, intervalMs);
    // Browsers return a number; Node timers can avoid keeping a CLI alive.
    timer.unref?.();
    return () => clearInterval(timer);
}
/** The host owns the output queue and capabilities. No PTY, native library or process-global writer is created. */
export function createTerminalClient(options) {
    const { write, reduceMotion = false, onError } = options;
    const capabilities = Object.freeze({ ...options.capabilities });
    const scheduler = options.schedule ?? schedule;
    let chrome = Object.freeze({});
    let disposed = false;
    let titleOwned = false;
    let cancel;
    let generation = 0;
    function stopSprite() {
        generation++;
        const previous = cancel;
        cancel = undefined;
        previous?.();
    }
    function send(next) {
        if (disposed || !capabilities.chrome)
            return false;
        const sequence = chromeSequence(next);
        if (!write(sequence))
            return false;
        chrome = next;
        return true;
    }
    function updateChrome(patch) {
        const next = normalize(patch, chrome);
        if (patch.sprite !== undefined || patch.mark !== undefined)
            stopSprite();
        return send(next);
    }
    function clearChrome() {
        stopSprite();
        if (!Object.keys(chrome).length)
            return false;
        return send(Object.freeze({}));
    }
    return Object.freeze({
        get chrome() {
            return chrome;
        },
        setTitle(title) {
            const sequence = titleSequence(title);
            if (disposed || !capabilities.title || !write(sequence))
                return false;
            titleOwned = title.length > 0;
            return true;
        },
        updateChrome,
        setStatus: (status) => updateChrome({ status }),
        setProgress: (progress) => updateChrome({ progress }),
        setMark: (mark) => updateChrome({ mark }),
        setSprite: (sprite) => updateChrome({ sprite }),
        playSprite(input) {
            fields(input, ["sprite", "intervalMs"]);
            const { intervalMs } = input;
            if (!Number.isInteger(intervalMs) ||
                intervalMs < 50 ||
                intervalMs > 60_000)
                throw new RangeError("sprite interval must be 50..60000 ms");
            const sprite = validateSprite(input.sprite);
            stopSprite();
            if (!send(normalize({ sprite, mark: 0 }, chrome)))
                return false;
            if (reduceMotion || sprite.frames.length === 1)
                return true;
            const token = generation;
            let frame = 0;
            cancel = scheduler(() => {
                if (disposed || token !== generation)
                    return;
                frame = (frame + 1) % sprite.frames.length;
                try {
                    if (!send(normalize({ mark: frame }, chrome)))
                        stopSprite();
                }
                catch (error) {
                    stopSprite();
                    if (onError)
                        onError(error);
                    else
                        throw error;
                }
            }, intervalMs);
            return true;
        },
        stopSprite,
        clearChrome,
        dispose() {
            if (disposed)
                return;
            stopSprite();
            // Invalidate queued ticks before attempting teardown, even if the writer throws.
            disposed = true;
            try {
                if (Object.keys(chrome).length)
                    write(CHROME_CLEAR_SEQUENCE);
            }
            finally {
                chrome = Object.freeze({});
                if (titleOwned)
                    write(titleSequence(""));
                titleOwned = false;
            }
        },
    });
}
