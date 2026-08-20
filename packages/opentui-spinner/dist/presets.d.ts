/**
 * Built-in spinner animation presets.
 *
 * Inlined from the `cli-spinners` package (MIT, Sindre Sorhus) so that
 * `@ax-code/opentui-spinner` has zero runtime dependency on third-party
 * spinner data. Add new presets here as needed.
 */
export interface SpinnerPreset {
    /** Intended time per frame, in milliseconds. */
    readonly interval: number;
    /** Array of frame strings to cycle through. */
    readonly frames: readonly string[];
}
declare const presets: {
    readonly dots: {
        readonly interval: 80;
        readonly frames: readonly ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    };
    readonly dots2: {
        readonly interval: 80;
        readonly frames: readonly ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
    };
    readonly dots3: {
        readonly interval: 80;
        readonly frames: readonly ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"];
    };
    readonly dots4: {
        readonly interval: 80;
        readonly frames: readonly ["⠄", "⠆", "⠇", "⠋", "⠙", "⠸", "⠰", "⠠", "⠰", "⠸", "⠙", "⠋", "⠇", "⠆"];
    };
    readonly dots5: {
        readonly interval: 80;
        readonly frames: readonly ["⠋", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"];
    };
    readonly dots9: {
        readonly interval: 80;
        readonly frames: readonly ["⢹", "⢺", "⢼", "⣸", "⣇", "⡧", "⡗", "⡏"];
    };
    readonly dots10: {
        readonly interval: 80;
        readonly frames: readonly ["⢄", "⢂", "⢁", "⡁", "⡈", "⡐", "⡠"];
    };
    readonly dots11: {
        readonly interval: 100;
        readonly frames: readonly ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];
    };
    readonly line: {
        readonly interval: 130;
        readonly frames: readonly ["-", "\\", "|", "/"];
    };
    readonly line2: {
        readonly interval: 100;
        readonly frames: readonly ["⠂", "-", "–", "—", "–", "-"];
    };
    readonly pipe: {
        readonly interval: 100;
        readonly frames: readonly ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"];
    };
    readonly simpleDots: {
        readonly interval: 400;
        readonly frames: readonly [".  ", ".. ", "...", "   "];
    };
    readonly star: {
        readonly interval: 70;
        readonly frames: readonly ["✶", "✸", "✹", "✺", "✹", "✷"];
    };
    readonly star2: {
        readonly interval: 80;
        readonly frames: readonly ["+", "x", "*"];
    };
    readonly flip: {
        readonly interval: 70;
        readonly frames: readonly ["_", "_", "_", "-", "`", "`", "'", "´", "-", "_", "_", "_"];
    };
    readonly hamburger: {
        readonly interval: 100;
        readonly frames: readonly ["☱", "☲", "☴"];
    };
    readonly growVertical: {
        readonly interval: 120;
        readonly frames: readonly ["▁", "▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"];
    };
    readonly growHorizontal: {
        readonly interval: 120;
        readonly frames: readonly ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"];
    };
    readonly balloon: {
        readonly interval: 140;
        readonly frames: readonly [" ", ".", "o", "O", "@", "*", " "];
    };
    readonly balloon2: {
        readonly interval: 120;
        readonly frames: readonly [".", "o", "O", "°", "O", "o", "."];
    };
    readonly bounce: {
        readonly interval: 120;
        readonly frames: readonly ["⠁", "⠂", "⠄", "⠂"];
    };
    readonly boxBounce: {
        readonly interval: 120;
        readonly frames: readonly ["▖", "▘", "▝", "▗"];
    };
    readonly boxBounce2: {
        readonly interval: 100;
        readonly frames: readonly ["▌", "▀", "▐", "▄"];
    };
    readonly triangle: {
        readonly interval: 50;
        readonly frames: readonly ["◢", "◣", "◤", "◥"];
    };
    readonly arc: {
        readonly interval: 100;
        readonly frames: readonly ["◜", "◠", "◝", "◞", "◡", "◟"];
    };
    readonly circle: {
        readonly interval: 120;
        readonly frames: readonly ["◡", "⊙", "◠"];
    };
    readonly squareCorners: {
        readonly interval: 180;
        readonly frames: readonly ["◰", "◳", "◲", "◱"];
    };
    readonly circleQuarters: {
        readonly interval: 120;
        readonly frames: readonly ["◴", "◷", "◶", "◵"];
    };
    readonly circleHalves: {
        readonly interval: 50;
        readonly frames: readonly ["◐", "◓", "◑", "◒"];
    };
    readonly squish: {
        readonly interval: 100;
        readonly frames: readonly ["╫", "╪"];
    };
    readonly toggle: {
        readonly interval: 250;
        readonly frames: readonly ["⊶", "⊷"];
    };
    readonly toggle2: {
        readonly interval: 80;
        readonly frames: readonly ["▫", "▪"];
    };
    readonly toggle3: {
        readonly interval: 120;
        readonly frames: readonly ["□", "■"];
    };
    readonly toggle4: {
        readonly interval: 100;
        readonly frames: readonly ["■", "□", "▪", "▫"];
    };
    readonly toggle5: {
        readonly interval: 100;
        readonly frames: readonly ["▮", "▯"];
    };
    readonly arrow: {
        readonly interval: 100;
        readonly frames: readonly ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"];
    };
    readonly arrow3: {
        readonly interval: 120;
        readonly frames: readonly ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"];
    };
    readonly bouncingBar: {
        readonly interval: 80;
        readonly frames: readonly ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[====]", "[ ===]", "[  ==]", "[   =]", "[    ]", "[   =]", "[  ==]", "[ ===]", "[====]", "[=== ]", "[==  ]", "[=   ]"];
    };
    readonly bouncingBall: {
        readonly interval: 80;
        readonly frames: readonly ["( ●    )", "(  ●   )", "(   ●  )", "(    ● )", "(     ●)", "(    ● )", "(   ●  )", "(  ●   )", "( ●    )", "(●     )"];
    };
    readonly aesthetic: {
        readonly interval: 80;
        readonly frames: readonly ["▰▱▱▱▱▱▱", "▰▰▱▱▱▱▱", "▰▰▰▱▱▱▱", "▰▰▰▰▱▱▱", "▰▰▰▰▰▱▱", "▰▰▰▰▰▰▱", "▰▰▰▰▰▰▰", "▰▱▱▱▱▱▱"];
    };
};
export type SpinnerName = keyof typeof presets;
/**
 * Returns the preset for the given spinner name, or `undefined` if not found.
 *
 * The parameter is a plain `string` (not `SpinnerName`) so callers can probe
 * arbitrary names at runtime and receive `undefined` for unknown values,
 * matching the constructor's validation path.
 */
export declare function getSpinnerPreset(name: string): SpinnerPreset | undefined;
/**
 * Returns all available preset names.
 */
export declare function getSpinnerNames(): SpinnerName[];
/**
 * Returns a random spinner preset.
 */
export declare function randomSpinner(): SpinnerPreset;
export default presets;
