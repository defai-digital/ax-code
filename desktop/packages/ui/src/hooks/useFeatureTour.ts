import { useCallback } from "react"
import { useUIStore } from "@/stores/useUIStore"

export const TOUR_STEPS = [
  {
    target: "[data-tour-target='sidebar']",
    titleKey: "featureTour.step1.title",
    descriptionKey: "featureTour.step1.description",
  },
  {
    target: "[data-tour-target='main-content']",
    titleKey: "featureTour.step2.title",
    descriptionKey: "featureTour.step2.description",
  },
  {
    target: "[data-tour-target='chat-input']",
    titleKey: "featureTour.step3.title",
    descriptionKey: "featureTour.step3.description",
  },
  {
    target: "[data-tour-target='context-panel']",
    titleKey: "featureTour.step4.title",
    descriptionKey: "featureTour.step4.description",
  },
  {
    target: "[data-tour-target='command-palette']",
    titleKey: "featureTour.step5.title",
    descriptionKey: "featureTour.step5.description",
  },
] as const

export function useFeatureTour() {
  const hasCompletedTour = useUIStore((s) => s.hasCompletedTour)
  const currentStep = useUIStore((s) => s.tourStep ?? 0)
  const isActive = !hasCompletedTour

  const nextStep = useCallback(() => {
    const step = useUIStore.getState().tourStep ?? 0
    if (step >= TOUR_STEPS.length - 1) {
      useUIStore.setState({ hasCompletedTour: true, tourStep: 0 })
    } else {
      useUIStore.setState({ tourStep: step + 1 })
    }
  }, [])

  const skip = useCallback(() => {
    useUIStore.setState({ hasCompletedTour: true, tourStep: 0 })
  }, [])

  return {
    isActive,
    currentStep,
    totalSteps: TOUR_STEPS.length,
    currentStepData: isActive ? TOUR_STEPS[currentStep] : null,
    nextStep,
    skip,
  }
}
