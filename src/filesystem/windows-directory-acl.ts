import { isAbsolute, join, parse } from "node:path";
import { NodeProcessRunner } from "../process/node-runner.js";
import type { ProcessRunner } from "../process/runner.js";

// Use the Windows .NET ACL API directly, without profiles or PowerShell modules.
// Paths are environment data, never executable PowerShell source.
const CHECK_ACL = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $trusted = @($current, 'S-1-5-18', 'S-1-5-32-544',
    'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $path = $env:DOORBELL_PRIVATE_DIRECTORY
  $private = $true
  while ($path) {
    $attributes = [IO.File]::GetAttributes($path)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 1 }
    $sections = [Security.AccessControl.AccessControlSections]'Access,Owner'
    $acl = [IO.Directory]::GetAccessControl($path, $sections)
    if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { exit 1 }
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $raw.DiscretionaryAcl) { exit 1 }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
      if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
      $sid = $rule.IdentityReference.Value
      $inheritOnly = ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0
      if ($trusted -contains $sid -or ($sid -eq 'S-1-3-0' -and $inheritOnly)) { continue }
      $rights = [long][int]$rule.FileSystemRights -band 0xFFFFFFFFL
      if ($private) {
        # Permit only traverse/synchronize to other principals, including inherited child rules.
        if (($rights -band (0xFFFFFFFFL -bxor 0x100020L)) -ne 0) { exit 1 }
      } elseif (-not $inheritOnly) {
        # Ancestors may be readable/create-only, but cannot permit replacement or ACL changes.
        if (($rights -band 0x500D0152L) -ne 0) { exit 1 }
      }
    }
    $parent = [IO.Directory]::GetParent($path)
    if ($null -eq $parent) { break }
    $path = $parent.FullName
    $private = $false
  }
  [Console]::Out.Write('private')
} catch { exit 1 }
`;

/** Conservative ACL validation; failures never trigger a permissions rewrite. */
export async function assertWindowsPrivateDirectory(
  directory: string,
  signal?: AbortSignal,
  runner: ProcessRunner = new NodeProcessRunner(),
): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "";
  if (!isAbsolute(systemRoot) || parse(systemRoot).root.length <= 1)
    throw new Error("Windows directory security verification is unavailable.");
  const result = await runner.run({
    command: join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(CHECK_ACL, "utf16le").toString("base64")],
    env: { DOORBELL_PRIVATE_DIRECTORY: directory },
    timeoutMs: 5000,
    ...(signal === undefined ? {} : { signal }),
  });
  signal?.throwIfAborted();
  if (!result.ok || result.stdout !== "private" || result.stderr.trim() !== "")
    throw new Error("Directory permissions are not private or could not be verified.");
}
