-- Existing deployments created by an intermediate native-runtime build may
-- contain AutomationExecution rows with this source. Keep the enum readable
-- while new code continues to write only VIDEO_WORKER or CONTROL_CENTER.
ALTER TYPE "ExecutionSource" ADD VALUE IF NOT EXISTS 'AUTOMATION_ENGINE';
