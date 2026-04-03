{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node-modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "ax-code";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.AX_CODE_DISABLE_MODELS_FETCH = true;
  env.AX_CODE_VERSION = finalAttrs.version;
  env.AX_CODE_CHANNEL = "local";

  buildPhase = ''
    runHook preBuild

    cd ./packages/ax-code
    bun --bun ./script/build.ts --single --skip-install
    bun --bun ./script/schema.ts schema.json

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/ax-code-*/bin/ax-code $out/bin/ax-code
    install -Dm644 schema.json $out/share/ax-code/schema.json

    wrapProgram $out/bin/ax-code \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if dunning on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      }

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # trick yargs into also generating zsh completions
    installShellCompletion --cmd ax-code \
      --bash <($out/bin/ax-code completion) \
      --zsh <(SHELL=/bin/zsh $out/bin/ax-code completion)
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "AX_CODE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    jsonschema = "${placeholder "out"}/share/ax-code/schema.json";
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://ax-code.ai/";
    license = lib.licenses.mit;
    mainProgram = "ax-code";
    inherit (node_modules.meta) platforms;
  };
})
