import { describe, expect, test } from "bun:test"

import { AgentControl } from "../../src/control-plane/agent-control"
import { ExecutionController } from "../../src/control-plane/execution-controller"

const plan = AgentControl.createPlan({
  id: "plan_01",
  objective: "Implement execution controller",
  tasks: [{ id: "task_01", title: "Define state machine" }],
})

const closedPlan = AgentControl.updateTaskStatus(plan, "task_01", "completed")

describe("ExecutionController", () => {
  test("routes assessment to planning when a plan is required", () => {
    const state = AgentControl.createState({ sessionID: "ses_123", objective: plan.objective })
    expect(ExecutionController.decide({ state, signal: { planRequired: true } })).toEqual({
      phase: "plan",
      reason: "plan_required",
    })
  })

  test("routes plan to approval when approval is required", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "plan",
      plan,
    })
    expect(ExecutionController.decide({ state, signal: { approvalRequired: true } })).toEqual({
      phase: "await_approval",
      reason: "approval_required",
    })
  })

  test("keeps approval phase pending until approval is granted", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "await_approval",
      plan,
    })
    expect(ExecutionController.apply({ state })).toMatchObject({
      phase: "await_approval",
      lastDecisionReason: "approval_pending",
    })
  })

  test("routes execution completion to validation when required", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(
      ExecutionController.apply({
        state,
        signal: { executionCompleted: true, validationRequired: true },
      }),
    ).toMatchObject({
      phase: "validate",
      validationStatus: "pending",
      lastDecisionReason: "validation_required",
    })
  })

  test("routes failed validation to recovery", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "validate",
      plan: closedPlan,
      validationStatus: "pending",
    })
    expect(ExecutionController.apply({ state, signal: { validationPassed: false } })).toMatchObject({
      phase: "recover",
      validationStatus: "failed",
      lastDecisionReason: "validation_failed",
    })
  })

  test("keeps validation pending until a validation result arrives", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "validate",
      plan: closedPlan,
      validationStatus: "pending",
    })
    expect(ExecutionController.apply({ state })).toMatchObject({
      phase: "validate",
      validationStatus: "pending",
      lastDecisionReason: "validation_pending",
    })
  })

  test("blocks summary when plan work remains open", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "summarize",
      plan,
      validationStatus: "passed",
    })
    expect(ExecutionController.apply({ state })).toMatchObject({
      phase: "blocked",
      blockedReason: "plan_tasks_open",
      lastDecisionReason: "plan_tasks_open",
    })
  })

  test("completes only when plan work is closed and validation passed", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "summarize",
      plan: closedPlan,
      validationStatus: "passed",
    })
    expect(ExecutionController.apply({ state })).toMatchObject({
      phase: "complete",
      validationStatus: "passed",
      lastDecisionReason: "ready_to_complete",
    })
  })

  test("routes assessment directly to execution when no plan is required", () => {
    const state = AgentControl.createState({ sessionID: "ses_123", objective: plan.objective })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "execute",
      reason: "ready_to_execute",
    })
  })

  test("routes assessment to planning when current plan has open tasks", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      plan,
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "plan",
      reason: "plan_required",
    })
  })

  test("routes plan phase to execution when plan is ready and no approval needed", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "plan",
      plan,
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "execute",
      reason: "plan_ready",
    })
  })

  test("routes plan phase to execution when approval was already granted", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "plan",
      plan,
    })
    expect(ExecutionController.decide({ state, signal: { approvalRequired: true, approvalGranted: true } })).toEqual({
      phase: "execute",
      reason: "plan_ready",
    })
  })

  test("keeps execution phase as awaiting_execution when no signal arrives", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "execute",
      reason: "awaiting_execution",
    })
  })

  test("keeps execution phase as in_progress when execution has started", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(ExecutionController.decide({ state, signal: { executionStarted: true } })).toEqual({
      phase: "execute",
      reason: "execution_in_progress",
    })
  })

  test("routes execution completion to summarize when no validation required", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(ExecutionController.decide({ state, signal: { executionCompleted: true } })).toEqual({
      phase: "summarize",
      reason: "execution_completed",
    })
  })

  test("routes passed validation to summarize phase", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "validate",
      plan: closedPlan,
      validationStatus: "pending",
    })
    expect(ExecutionController.apply({ state, signal: { validationPassed: true } })).toMatchObject({
      phase: "summarize",
      validationStatus: "passed",
      lastDecisionReason: "validation_passed",
    })
  })

  test("routes recovery to execution retry when plan is closed", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "recover",
      plan: closedPlan,
      validationStatus: "failed",
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "execute",
      reason: "retry_execution",
    })
  })

  test("routes recovery to re-planning when plan has open work", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "recover",
      plan,
      validationStatus: "failed",
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "plan",
      reason: "replan_required",
    })
  })

  test("routes blocked phase back to reassessment by default", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "blocked",
      plan: closedPlan,
      validationStatus: "passed",
      blockedReason: "plan_tasks_open",
    })
    expect(ExecutionController.decide({ state })).toEqual({
      phase: "assess",
      reason: "reassess_after_block",
    })
  })

  test("routes blocked phase to planning when user unblocks with a plan", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "blocked",
      plan: closedPlan,
      validationStatus: "passed",
      blockedReason: "plan_tasks_open",
    })
    expect(ExecutionController.decide({ state, signal: { planRequired: true } })).toEqual({
      phase: "plan",
      reason: "user_unblocked_with_plan",
    })
  })

  test("routes blocked phase to execution when user unblocks with execution", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "blocked",
      plan: closedPlan,
      validationStatus: "passed",
      blockedReason: "plan_tasks_open",
    })
    expect(ExecutionController.decide({ state, signal: { executionStarted: true } })).toEqual({
      phase: "execute",
      reason: "user_unblocked_with_execution",
    })
  })

  test("keeps complete phase as already_complete", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "summarize",
      plan: closedPlan,
      validationStatus: "passed",
    })
    const completed = ExecutionController.apply({ state })
    expect(ExecutionController.decide({ state: completed })).toEqual({
      phase: "complete",
      reason: "already_complete",
    })
  })

  test("routes unrecoverable failure signal to blocked phase from any phase", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(
      ExecutionController.decide({ state, signal: { unrecoverableFailure: true, blockedReason: "tool_timeout" } }),
    ).toEqual({
      phase: "blocked",
      reason: "tool_timeout",
      blockedReason: "tool_timeout",
    })
  })

  test("routes recoverable failure signal to recover phase", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "execute",
      plan: closedPlan,
    })
    expect(ExecutionController.decide({ state, signal: { recoverableFailure: true } })).toMatchObject({
      phase: "recover",
      reason: "recoverable_failure",
    })
  })

  test("preserves validation status as failed during recoverable failure", () => {
    const state = AgentControl.createState({
      sessionID: "ses_123",
      objective: plan.objective,
      phase: "validate",
      plan: closedPlan,
      validationStatus: "pending",
    })
    expect(ExecutionController.decide({ state, signal: { recoverableFailure: true } })).toMatchObject({
      phase: "recover",
      validationStatus: "failed",
    })
  })
})
