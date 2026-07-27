import React from "react"
import { toast } from "@/components/ui"
import { AgentManagerSidebar } from "./AgentManagerSidebar"
import { AgentManagerEmptyState } from "./AgentManagerEmptyState"
import { AgentGroupDetail } from "./AgentGroupDetail"
import { cn } from "@/lib/utils"
import { useAgentGroupsStore } from "@/stores/useAgentGroupsStore"
import { useMultiRunStore } from "@/stores/useMultiRunStore"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import type { CreateMultiRunParams } from "@/types/multirun"
import { useI18n } from "@/lib/i18n"

interface AgentManagerViewProps {
  className?: string
}

export const AgentManagerView: React.FC<AgentManagerViewProps> = ({ className }) => {
  const currentDirectory = useDirectoryStore((s) => s.currentDirectory)

  const groups = useAgentGroupsStore((s) => s.groups)
  const selectedGroupName = useAgentGroupsStore((s) => s.selectedGroupName)
  const selectGroup = useAgentGroupsStore((s) => s.selectGroup)
  const loadGroups = useAgentGroupsStore((s) => s.loadGroups)

  const createMultiRun = useMultiRunStore((s) => s.createMultiRun)
  const isCreatingMultiRun = useMultiRunStore((s) => s.isLoading)
  const { t } = useI18n()

  const selectedGroup = React.useMemo(
    () => (selectedGroupName ? (groups.find((g) => g.name === selectedGroupName) ?? null) : null),
    [groups, selectedGroupName],
  )

  // Load groups on mount and when directory changes
  React.useEffect(() => {
    void loadGroups()
  }, [currentDirectory, loadGroups])

  const handleGroupSelect = React.useCallback(
    (groupName: string) => {
      selectGroup(groupName)
    },
    [selectGroup],
  )

  const handleNewAgent = React.useCallback(() => {
    selectGroup(null)
  }, [selectGroup])

  const handleCreateGroup = React.useCallback(
    async (params: CreateMultiRunParams) => {
      const totalModels = params.groups.reduce((sum, g) => sum + g.models.length, 0)
      toast.info(t("agentManager.view.toast.creatingGroup", { name: params.name, count: totalModels }))

      const result = await createMultiRun(params)

      if (result) {
        toast.success(t("agentManager.view.toast.createdGroup", { name: params.name, count: result.sessionIds.length }))
        // Refresh groups — new worktrees + sessions now exist
        await loadGroups()
        selectGroup(result.groupSlug)
      } else {
        const error = useMultiRunStore.getState().error
        toast.error(error || t("agentManager.empty.toast.failedToCreateGroup"))
      }
    },
    [createMultiRun, loadGroups, selectGroup, t],
  )

  return (
    <div className={cn("flex h-full w-full bg-background", className)}>
      <div className="w-64 flex-shrink-0">
        <AgentManagerSidebar
          groups={groups}
          selectedGroupName={selectedGroupName}
          onGroupSelect={handleGroupSelect}
          onNewAgent={handleNewAgent}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selectedGroup ? (
          <AgentGroupDetail group={selectedGroup} />
        ) : (
          <AgentManagerEmptyState onCreateGroup={handleCreateGroup} isCreating={isCreatingMultiRun} />
        )}
      </div>
    </div>
  )
}
