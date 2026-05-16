import { createMemo, createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { createStore } from "solid-js/store"
import { createAbortableResourceFetcher } from "../util/abortable-resource"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const sdk = useSDK()
  const dialog = useDialog()

  const [store, setStore] = createStore({
    filter: "",
  })

  const [files] = createResource(
    () => [store.filter],
    createAbortableResourceFetcher(async (_filter: string[], signal) => {
      const result = await sdk.client.find.files(
        {
          query: store.filter,
        },
        { signal },
      )
      if (result.error) return []
      const sliced = (result.data ?? []).slice(0, 5)
      return sliced
    }),
  )

  const options = createMemo(() =>
    (files() ?? []).map((file) => ({
      value: file,
      title: file,
    })),
  )

  return (
    <DialogSelect
      title="Autocomplete"
      options={options()}
      onFilter={(filter) => setStore("filter", filter)}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
