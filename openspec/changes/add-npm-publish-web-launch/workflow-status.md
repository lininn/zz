# Workflow Status: add-npm-publish-web-launch

## Summary

- Phase: spec
- Capture Mode: none
- Status: ready_for_next_phase
- Last Updated: 2026-09-29
- Next Command: /openflow build
- Next Action: Execute implementation plan.

## Gates

| Gate | Status | Evidence |
|------|--------|----------|
| Requirements captured | passed | proposal.md |
| Grill decision | passed | proposal.md grill-me 决策记录（Q1-Q4） |
| Specs validated | passed | specs/*, tasks.md |
| Plan ready | passed | plan-ready.md |
| Implementation complete | pending | - |
| Verification complete | pending | - |
| Archived | pending | - |

## Tasks

| ID | Task | Status | Verification | Blocked By | Notes |
|----|------|--------|--------------|------------|-------|
| T1 | npm 单体包改造（bin `zz`、去 private、内嵌 web-dist） | pending | `npm pack` 结构正确，`zz --version` 可用 | - | Slice 1 |
| T2 | 新增 `--web` / `--web-port` 参数与命令处理 | pending | `zz --web` 启动并打开浏览器 | T1 | Slice 2 |
| T3 | 端口默认 3030 + 自动回退 | pending | 端口被占时自动回退并提示 | T2 | Slice 2 |
| T4 | connector 上报 PC 端 ZCode 版本 | pending | relay 能读到设备版本，unknown 兜底 | - | Slice 4 |
| T5 | relay web-dist 多版本目录 + 路由 | pending | relay 按版本路由，缺失时提示 | T4 | Slice 5 |
| T6 | relay 版本不匹配提示页 | pending | 版本缺失时返回友好提示页 | T5 | Slice 5 |
| T7 | deploy-web-kd1.sh 改造（版本分目录部署） | pending | kd1 web-dist 多版本互不覆盖 | T1,T5 | Slice 6 |
| T8 | CI/CD 流水线 | pending | tag 触发后全链路自动完成 | T1,T7 | Slice 7 |
| T9 | 登录页信息泄露修复（安全） | pending | 登录页不显示连接信息 | - | Slice 3 |

## Amendments

| Date | Reason | Affected Specs | Affected Tasks | Status |
|------|--------|----------------|----------------|--------|
