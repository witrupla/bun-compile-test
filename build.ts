const entrypoint = "./src/mtcute-graph.ts"
const outfile = "./dist/mtcute-graph"
const target = "bun-linux-x64-modern"

const result = await Bun.build({
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadPackageJson: true,
    autoloadTsconfig: true,
    outfile,
    target,
  },
  entrypoints: [entrypoint],
  target: "bun",
  tsconfig: "./tsconfig.json",
})

if (!result.success) {
  for (const log of result.logs) {
    const location =
      log.position === null
        ? ""
        : `${log.position.file}:${log.position.line}:${log.position.column}: `

    console.error(`${location}${log.level}: ${log.message}`)
  }

  throw new Error(`Build failed for ${entrypoint} on ${target}`)
}

console.log(`Built ${outfile} from ${entrypoint} for ${target}`)
