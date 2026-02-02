# 本地通过 pnpm link 使用 @gitlabx/cli

本文说明如何在本地使用 `pnpm link` 将 `@gitlabx/cli` 链接到其他项目，以及链接后的更新机制。

## 1. 先在本仓库构建一次

`@gitlabx/cli` 的 CLI 可执行文件来自 `apps/cli/dist`，因此需要先构建。

```bash
pnpm -C apps/cli build
```

如果你希望开发时自动更新，可在另一个终端执行：

```bash
pnpm -C apps/cli dev
```

## 2. 将 @gitlabx/cli 链接到全局

在本仓库执行：

```bash
pnpm -C apps/cli link --global
```

这会把本地包注册到全局 `pnpm` 链接区。

## 3. 在目标项目中使用链接

进入你想使用的项目目录：

```bash
pnpm link --global @gitlabx/cli
```

完成后你可以：

- 直接使用 CLI：`gbx -v`
- 在代码中导入 API：

```ts
import { createProgram, runCli } from '@gitlabx/cli'
```

## 4. 链接后的更新机制

**结论：不需要重复 link，但需要重新 build（或保持 dev watch）。**

- `pnpm link` 只是创建了符号链接，指向本地包目录。
- 当你修改 `apps/cli/src` 后，需要重新 `build` 生成 `dist`，链接项目才能拿到最新代码。
- 如果你一直在跑 `pnpm -C apps/cli dev`（watch 构建），每次构建完成后即可自动更新，**无需重新 link**。

## 5. 什么时候需要重新 link

一般情况下不需要重新 link，除非：

- 修改了 `package.json` 的 `name` 或 `bin` 映射
- 执行了 `pnpm unlink --global`
- 目标项目中移除了链接依赖

## 6. 取消链接

在目标项目中执行：

```bash
pnpm unlink --global @gitlabx/cli
```

在包目录中执行（清理全局链接）：

```bash
pnpm -C apps/cli unlink --global
```

## 7. 同仓库使用（推荐 workspace:\*）

如果目标项目就在本仓库内，建议直接使用 workspace 依赖，避免 link：

1. 在目标包 `package.json` 中添加依赖：

```json
{
  "dependencies": {
    "@gitlabx/cli": "workspace:*"
  }
}
```

2. 重新安装依赖：

```bash
pnpm install
```

这样会自动使用本地源码包。若依赖的是 `dist` 产物，仍需 `pnpm -C apps/cli build` 或 `pnpm -C apps/cli dev` 来持续更新。
