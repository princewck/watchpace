import SwiftUI

struct TVSelectionPicker: View {
  @Environment(FamilyStore.self) private var store
  var body: some View {
    Picker(
      L10n.tr("当前电视"),
      selection: Binding(
        get: { store.selectedID ?? "" }, set: { id in Task { await store.select(id) } }
      )
    ) {
      ForEach(store.devices) { Text($0.label).tag($0.id) }
    }.disabled(store.busy).accessibilityIdentifier("currentTVPicker")
  }
}
struct TVSelectionSection: View {
  @Environment(FamilyStore.self) private var store
  var body: some View {
    if store.devices.count > 1 { Section { TVSelectionPicker() } }
  }
}
