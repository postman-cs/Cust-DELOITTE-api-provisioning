# Build Log: Cust-DELOITTE-api-provisioning

## Context
- AE / CSE: Daniel Shively (CSE)
- Customer technical lead: Deloitte — API platform / developer experience team
- Sprint dates: TBD

## Hypothesis
- If we build a governance-first API provisioning platform demo, we will prove that Postman can serve as the control plane for enterprise workspace provisioning, policy enforcement, and partner onboarding at Deloitte scale.

## Success Criteria
- Workspace provisioning pipeline creates partner workspaces from a golden workspace with domain guardrails
- Invite guard enforces email domain allowlists across provisioned workspaces
- Compliance security floor prevents teams from loosening baseline controls
- Collection protection with PR-style review workflow prevents unreviewed changes
- Full audit trail for all provisioning and policy actions

## Environment Baseline
- SCM: GitHub (postman-cs/Cust-DELOITTE-api-provisioning)
- CI/CD: Makefile-driven (make setup, make dev, make demo-all)
- Gateway: N/A (provisioning layer sits above gateway)
- Cloud: Node.js service, deployable anywhere
- Dev Portal: N/A (demo focuses on workspace provisioning)
- Current Postman usage: Golden workspace pattern with target workspaces for AWS/Azure/On-Prem
- v11/v12: Leverages Spec Hub for seeded collections tagged [AWS] / [Azure] / [On-Prem]

## What We Built
- Express/TypeScript API provisioning service (@deloitte/api-provisioning-service)
- Mock and live Postman API client adapters (IPostmanClient interface)
- Policy engine with configurable domain allowlists and compliance rules
- Invite guard service for email/domain enforcement
- Compliance guardrails service with security floor (teams can only tighten, not loosen)
- Collection protection service with PR-style approval workflow
- In-memory audit logger with full action trail
- Vanilla HTML + Tailwind demo UI with 12-step guided narrative
- JWT/OIDC auth middleware (optional), RBAC (admin/provisioner/viewer)
- OpenAPI 3.1 spec (api/openapi.yaml)
- Zod request validation, Winston logging, Helmet security headers

## Value Unlocked
- Demonstrates enterprise-grade workspace governance at scale
- Shows partner onboarding workflow with domain-scoped guardrails
- Proves Postman API can power automated provisioning pipelines
- Live cross-workspace provisioning against real Postman workspaces

## Reusable Pattern
- Golden workspace → partner workspace provisioning pipeline
- Policy engine with domain allowlists and compliance floor
- Mock/live adapter pattern for Postman API integration demos
- 12-step guided demo UI for workshop presentations

## Product Gaps / Risks
- In-memory audit log does not persist across restarts (production would need a database)
- RBAC is simplified for demo; production needs full OIDC integration
- Live provisioning requires valid Postman API key with workspace admin permissions

## Next Step
- Present provisioning demo to Deloitte API platform team
- Identify pilot partner workspace for live provisioning proof-of-concept
- Evaluate integration with Deloitte's existing OIDC/SSO infrastructure
