import { describe, expect, test } from "vitest"
import { classifyDestructiveCommand } from "../../src/tool/bash-destructive"

describe("classifyDestructiveCommand", () => {
  test("flags recursive force rm in all spellings", () => {
    expect(classifyDestructiveCommand(["rm", "-rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["rm", "-fr", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["rm", "-r", "-f", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["rm", "-Rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["rm", "--recursive", "--force", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["/bin/rm", "-rf", "build"])).toBeTruthy()
  })

  test("flags recursive rm targeting root or home even without force", () => {
    expect(classifyDestructiveCommand(["rm", "-r", "/"])).toBeTruthy()
    expect(classifyDestructiveCommand(["rm", "-r", "~"])).toBeTruthy()
  })

  test("does not flag routine rm usage", () => {
    expect(classifyDestructiveCommand(["rm", "file.txt"])).toBeUndefined()
    expect(classifyDestructiveCommand(["rm", "-f", "file.txt"])).toBeUndefined()
    expect(classifyDestructiveCommand(["rm", "-r", "node_modules"])).toBeUndefined()
  })

  test("flags destructive git operations", () => {
    expect(classifyDestructiveCommand(["git", "push", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "push", "-f", "origin", "main"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "push", "--force-with-lease"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "push", "origin", "+main"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "push", "--delete", "origin", "old-branch"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "reset", "--hard", "HEAD~3"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "clean", "-fdx"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "branch", "-D", "feature"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "-C", "/repo", "push", "--force"])).toBeTruthy()
  })

  test("does not flag routine git usage", () => {
    expect(classifyDestructiveCommand(["git", "push"])).toBeUndefined()
    expect(classifyDestructiveCommand(["git", "push", "origin", "main"])).toBeUndefined()
    expect(classifyDestructiveCommand(["git", "reset", "--soft", "HEAD~1"])).toBeUndefined()
    expect(classifyDestructiveCommand(["git", "clean", "-n"])).toBeUndefined()
    expect(classifyDestructiveCommand(["git", "branch", "-d", "merged"])).toBeUndefined()
    expect(classifyDestructiveCommand(["git", "commit", "-m", "msg"])).toBeUndefined()
  })

  test("looks through wrapper commands", () => {
    expect(classifyDestructiveCommand(["sudo", "rm", "-rf", "/var/data"])).toBeTruthy()
    expect(classifyDestructiveCommand(["env", "FOO=bar", "git", "push", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["xargs", "rm", "-rf"])).toBeTruthy()
    expect(classifyDestructiveCommand(["nohup", "shutdown", "-h", "now"])).toBeTruthy()
  })

  test("flags disk, system, and database destroyers", () => {
    expect(classifyDestructiveCommand(["mkfs.ext4", "/dev/sda1"])).toBeTruthy()
    expect(classifyDestructiveCommand(["shred", "-u", "secret.key"])).toBeTruthy()
    expect(classifyDestructiveCommand(["dd", "if=/dev/zero", "of=/dev/sda"])).toBeTruthy()
    expect(classifyDestructiveCommand(["reboot"])).toBeTruthy()
    expect(classifyDestructiveCommand(["psql", "-c", "DROP TABLE users"])).toBeTruthy()
    expect(classifyDestructiveCommand(["mysql", "-e", "truncate table sessions"])).toBeTruthy()
    expect(classifyDestructiveCommand(["terraform", "destroy"])).toBeTruthy()
    expect(classifyDestructiveCommand(["terraform", "apply", "-auto-approve"])).toBeTruthy()
  })

  test("does not flag benign lookalikes", () => {
    expect(classifyDestructiveCommand(["dd", "if=/dev/zero", "of=disk.img"])).toBeUndefined()
    expect(classifyDestructiveCommand(["psql", "-c", "SELECT * FROM users"])).toBeUndefined()
    expect(classifyDestructiveCommand(["terraform", "plan"])).toBeUndefined()
    expect(classifyDestructiveCommand(["grep", "-r", "DROP TABLE", "src"])).toBeUndefined()
    expect(classifyDestructiveCommand(["echo", "rm", "-rf", "/"])).toBeUndefined()
    expect(classifyDestructiveCommand([])).toBeUndefined()
    expect(classifyDestructiveCommand(["ls", "-la"])).toBeUndefined()
  })
})
