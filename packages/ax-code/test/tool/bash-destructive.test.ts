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
    expect(classifyDestructiveCommand(["git", "branch", "-Df", "feature"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "branch", "-fD", "feature"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "branch", "-d", "-f", "feature"])).toBeTruthy()
    expect(classifyDestructiveCommand(["git", "branch", "--delete", "--force", "feature"])).toBeTruthy()
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
    expect(classifyDestructiveCommand(["sudo", "-u", "root", "rm", "-rf", "/var/data"])).toBeTruthy()
    expect(classifyDestructiveCommand(["sudo", "-nu", "root", "rm", "-rf", "/var/data"])).toBeTruthy()
    expect(classifyDestructiveCommand(["doas", "-u", "root", "git", "push", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["env", "FOO=bar", "git", "push", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["env", "-u", "TOKEN", "git", "push", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["env", "-S", "rm -rf build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["sudo", "env", "--split-string=git push --force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["xargs", "rm", "-rf"])).toBeTruthy()
    expect(classifyDestructiveCommand(["xargs", "-n", "1", "rm", "-rf"])).toBeTruthy()
    expect(classifyDestructiveCommand(["nohup", "shutdown", "-h", "now"])).toBeTruthy()
    expect(classifyDestructiveCommand(["nice", "-n", "10", "rm", "-rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["timeout", "--signal", "TERM", "30", "rm", "-rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["setsid", "rm", "-rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["stdbuf", "-o", "L", "rm", "-rf", "build"])).toBeTruthy()
    expect(classifyDestructiveCommand(["ionice", "-c", "2", "-n", "7", "rm", "-rf", "build"])).toBeTruthy()
  })

  test("does not mistake wrapper option values for commands", () => {
    expect(classifyDestructiveCommand(["sudo", "-p", "rm", "ls"])).toBeUndefined()
    expect(classifyDestructiveCommand(["env", "-u", "rm", "ls"])).toBeUndefined()
    expect(classifyDestructiveCommand(["env", "-S", "printf hello"])).toBeUndefined()
    expect(classifyDestructiveCommand(["time", "-o", "rm", "ls"])).toBeUndefined()
    expect(classifyDestructiveCommand(["xargs", "-I", "rm", "echo", "rm"])).toBeUndefined()
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

  test("flags aws mutating verbs", () => {
    expect(classifyDestructiveCommand(["aws", "ec2", "terminate-instances", "--instance-ids", "i-1"])).toBeTruthy()
    expect(classifyDestructiveCommand(["aws", "iam", "delete-user", "--user-name", "x"])).toBeTruthy()
    expect(classifyDestructiveCommand(["aws", "s3", "rm", "s3://b/k"])).toBeTruthy()
    expect(classifyDestructiveCommand(["aws", "s3", "rb", "s3://b", "--force"])).toBeTruthy()
    expect(classifyDestructiveCommand(["sudo", "aws", "ec2", "delete-volume", "--volume-id", "v-1"])).toBeTruthy()
  })

  test("skips leading environment assignments before the command name", () => {
    expect(
      classifyDestructiveCommand(["AWS_PROFILE=prod", "aws", "ec2", "delete-vpc", "--vpc-id", "vpc-1"]),
    ).toBeTruthy()
    expect(classifyDestructiveCommand(["AWS_PROFILE=prod", "aws", "ec2", "describe-instances"])).toBeUndefined()
  })

  test("does not flag aws read-only or dry-run usage", () => {
    expect(classifyDestructiveCommand(["aws", "ec2", "describe-instances"])).toBeUndefined()
    expect(classifyDestructiveCommand(["aws", "s3", "ls"])).toBeUndefined()
    expect(classifyDestructiveCommand(["aws", "iam", "list-users"])).toBeUndefined()
    expect(classifyDestructiveCommand(["aws", "ec2", "terminate-instances", "--dry-run"])).toBeUndefined()
  })

  test("flags gcloud, az, and doctl delete/destroy verbs past value flags", () => {
    expect(
      classifyDestructiveCommand(["gcloud", "--project", "prod", "compute", "instances", "delete", "vm1"]),
    ).toBeTruthy()
    expect(classifyDestructiveCommand(["gcloud", "secrets", "versions", "destroy", "1", "--secret", "s"])).toBeTruthy()
    expect(classifyDestructiveCommand(["az", "group", "delete", "-n", "rg"])).toBeTruthy()
    expect(classifyDestructiveCommand(["doctl", "compute", "droplet", "delete", "12345"])).toBeTruthy()
  })

  test("does not flag gcloud, az, and doctl read-only usage", () => {
    expect(classifyDestructiveCommand(["gcloud", "compute", "instances", "list"])).toBeUndefined()
    expect(classifyDestructiveCommand(["az", "vm", "list"])).toBeUndefined()
    expect(classifyDestructiveCommand(["doctl", "compute", "droplet", "list"])).toBeUndefined()
  })

  test("flags kubectl delete and apply --prune", () => {
    expect(classifyDestructiveCommand(["kubectl", "delete", "deployment", "api"])).toBeTruthy()
    expect(classifyDestructiveCommand(["kubectl", "-n", "prod", "delete", "pod", "x"])).toBeTruthy()
    expect(classifyDestructiveCommand(["kubectl", "apply", "-f", "x.yaml", "--prune", "-l", "app=y"])).toBeTruthy()
  })

  test("does not flag kubectl reads, dry-run deletes, or plain applies", () => {
    expect(classifyDestructiveCommand(["kubectl", "get", "pods"])).toBeUndefined()
    expect(classifyDestructiveCommand(["kubectl", "delete", "--dry-run=client", "pod", "x"])).toBeUndefined()
    expect(classifyDestructiveCommand(["kubectl", "apply", "-f", "manifest.yaml"])).toBeUndefined()
  })

  test("flags wrangler delete and rollback", () => {
    expect(classifyDestructiveCommand(["wrangler", "delete"])).toBeTruthy()
    expect(classifyDestructiveCommand(["wrangler", "d1", "delete", "my-db"])).toBeTruthy()
  })

  test("does not flag wrangler deploy or list", () => {
    expect(classifyDestructiveCommand(["wrangler", "deploy"])).toBeUndefined()
    expect(classifyDestructiveCommand(["wrangler", "d1", "list"])).toBeUndefined()
  })

  test("flags terraform apply without a reviewed plan file", () => {
    expect(classifyDestructiveCommand(["terraform", "apply"])).toBeTruthy()
    expect(classifyDestructiveCommand(["terraform", "apply", "-var-file=prod.tfvars"])).toBeTruthy()
    expect(classifyDestructiveCommand(["terraform", "apply", "-target=module.foo"])).toBeTruthy()
  })

  test("does not flag terraform plan, validate, or reviewed applies", () => {
    expect(classifyDestructiveCommand(["terraform", "plan"])).toBeUndefined()
    expect(classifyDestructiveCommand(["terraform", "apply", "plan.tfplan"])).toBeUndefined()
    expect(classifyDestructiveCommand(["terraform", "apply", "-var-file=x.tfvars", "plan.tfplan"])).toBeUndefined()
    expect(classifyDestructiveCommand(["terraform", "apply", "-out=tfplan"])).toBeUndefined()
    expect(classifyDestructiveCommand(["terraform", "validate"])).toBeUndefined()
  })

  test("flags ssh remote device commit without commit-confirm", () => {
    expect(classifyDestructiveCommand(["ssh", "router", "commit"])).toBeTruthy()
    expect(classifyDestructiveCommand(["ssh", "admin@r1", "configure; commit"])).toBeTruthy()
  })

  test("does not flag ssh reads or commit-confirm/commit check/git commit", () => {
    expect(classifyDestructiveCommand(["ssh", "host", "uptime"])).toBeUndefined()
    expect(classifyDestructiveCommand(["ssh", "router", "commit confirmed 5"])).toBeUndefined()
    expect(classifyDestructiveCommand(["ssh", "router", "commit check"])).toBeUndefined()
    expect(classifyDestructiveCommand(["ssh", "host", "git commit -m x"])).toBeUndefined()
    expect(classifyDestructiveCommand(["ssh", "router", "show configuration"])).toBeUndefined()
  })

  test("flags curl mutating methods against cloud control-plane hosts", () => {
    expect(
      classifyDestructiveCommand(["curl", "-X", "DELETE", "https://api.cloudflare.com/client/v4/zones/1"]),
    ).toBeTruthy()
    expect(classifyDestructiveCommand(["curl", "-XDELETE", "https://api.digitalocean.com/v2/droplets/1"])).toBeTruthy()
    expect(
      classifyDestructiveCommand(["curl", "-d", "@f.json", "https://ec2.amazonaws.com/?Action=TerminateInstances"]),
    ).toBeTruthy()
  })

  test("does not flag curl reads, plain fetches, or non-cloud posts", () => {
    expect(
      classifyDestructiveCommand(["curl", "-X", "GET", "https://api.cloudflare.com/client/v4/zones"]),
    ).toBeUndefined()
    expect(classifyDestructiveCommand(["curl", "https://example.com"])).toBeUndefined()
    expect(classifyDestructiveCommand(["curl", "-X", "POST", "http://localhost:3000/api"])).toBeUndefined()
    expect(
      classifyDestructiveCommand(["curl", "-X", "POST", "http://169.254.169.254/latest/api/token"]),
    ).toBeUndefined()
  })
})
