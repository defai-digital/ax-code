/**
 * Built-in spinner animation presets.
 *
 * Inlined from the `cli-spinners` package (MIT, Sindre Sorhus) so that
 * `@ax-code/opentui-spinner` has zero runtime dependency on third-party
 * spinner data. Add new presets here as needed.
 */
const presets = {
    dots: { interval: 80, frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] },
    dots2: { interval: 80, frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] },
    dots3: { interval: 80, frames: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"] },
    dots4: {
        interval: 80,
        frames: ["⠄", "⠆", "⠇", "⠋", "⠙", "⠸", "⠰", "⠠", "⠰", "⠸", "⠙", "⠋", "⠇", "⠆"],
    },
    dots5: {
        interval: 80,
        frames: ["⠋", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"],
    },
    dots9: { interval: 80, frames: ["⢹", "⢺", "⢼", "⣸", "⣇", "⡧", "⡗", "⡏"] },
    dots10: { interval: 80, frames: ["⢄", "⢂", "⢁", "⡁", "⡈", "⡐", "⡠"] },
    dots11: { interval: 100, frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"] },
    line: { interval: 130, frames: ["-", "\\", "|", "/"] },
    line2: { interval: 100, frames: ["⠂", "-", "–", "—", "–", "-"] },
    pipe: { interval: 100, frames: ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"] },
    simpleDots: { interval: 400, frames: [".  ", ".. ", "...", "   "] },
    star: { interval: 70, frames: ["✶", "✸", "✹", "✺", "✹", "✷"] },
    star2: { interval: 80, frames: ["+", "x", "*"] },
    flip: { interval: 70, frames: ["_", "_", "_", "-", "`", "`", "'", "´", "-", "_", "_", "_"] },
    hamburger: { interval: 100, frames: ["☱", "☲", "☴"] },
    growVertical: { interval: 120, frames: ["▁", "▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"] },
    growHorizontal: {
        interval: 120,
        frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"],
    },
    balloon: { interval: 140, frames: [" ", ".", "o", "O", "@", "*", " "] },
    balloon2: { interval: 120, frames: [".", "o", "O", "°", "O", "o", "."] },
    bounce: { interval: 120, frames: ["⠁", "⠂", "⠄", "⠂"] },
    boxBounce: { interval: 120, frames: ["▖", "▘", "▝", "▗"] },
    boxBounce2: { interval: 100, frames: ["▌", "▀", "▐", "▄"] },
    triangle: { interval: 50, frames: ["◢", "◣", "◤", "◥"] },
    arc: { interval: 100, frames: ["◜", "◠", "◝", "◞", "◡", "◟"] },
    circle: { interval: 120, frames: ["◡", "⊙", "◠"] },
    squareCorners: { interval: 180, frames: ["◰", "◳", "◲", "◱"] },
    circleQuarters: { interval: 120, frames: ["◴", "◷", "◶", "◵"] },
    circleHalves: { interval: 50, frames: ["◐", "◓", "◑", "◒"] },
    squish: { interval: 100, frames: ["╫", "╪"] },
    toggle: { interval: 250, frames: ["⊶", "⊷"] },
    toggle2: { interval: 80, frames: ["▫", "▪"] },
    toggle3: { interval: 120, frames: ["□", "■"] },
    toggle4: { interval: 100, frames: ["■", "□", "▪", "▫"] },
    toggle5: { interval: 100, frames: ["▮", "▯"] },
    arrow: { interval: 100, frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"] },
    arrow3: {
        interval: 120,
        frames: ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"],
    },
    bouncingBar: {
        interval: 80,
        frames: [
            "[    ]",
            "[=   ]",
            "[==  ]",
            "[=== ]",
            "[====]",
            "[ ===]",
            "[  ==]",
            "[   =]",
            "[    ]",
            "[   =]",
            "[  ==]",
            "[ ===]",
            "[====]",
            "[=== ]",
            "[==  ]",
            "[=   ]",
        ],
    },
    bouncingBall: {
        interval: 80,
        frames: [
            "( ●    )",
            "(  ●   )",
            "(   ●  )",
            "(    ● )",
            "(     ●)",
            "(    ● )",
            "(   ●  )",
            "(  ●   )",
            "( ●    )",
            "(●     )",
        ],
    },
    aesthetic: {
        interval: 80,
        frames: ["▰▱▱▱▱▱▱", "▰▰▱▱▱▱▱", "▰▰▰▱▱▱▱", "▰▰▰▰▱▱▱", "▰▰▰▰▰▱▱", "▰▰▰▰▰▰▱", "▰▰▰▰▰▰▰", "▰▱▱▱▱▱▱"],
    },
};
/**
 * Returns the preset for the given spinner name, or `undefined` if not found.
 *
 * The parameter is a plain `string` (not `SpinnerName`) so callers can probe
 * arbitrary names at runtime and receive `undefined` for unknown values,
 * matching the constructor's validation path.
 */
export function getSpinnerPreset(name) {
    return presets[name];
}
/**
 * Returns all available preset names.
 */
export function getSpinnerNames() {
    return Object.keys(presets);
}
/**
 * Returns a random spinner preset.
 */
export function randomSpinner() {
    const names = getSpinnerNames();
    return presets[names[Math.floor(Math.random() * names.length)]];
}
export default presets;
