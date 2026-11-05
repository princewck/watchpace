import SwiftUI

struct AgeViewingPresetsView: View {
  @Environment(FamilyStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var selected: AgeViewingPreset?
  @State private var applying = false
  let policy: ViewingPolicy
  let onApply: (ViewingPolicy) async -> Bool
  private var ready: Bool { store.demo || (store.selected?.session_rules_version ?? 0) >= 1 }
  var body: some View {
    List {
      Section {
        Text(L10n.tr("选一个适合家庭的起点，再根据实际情况调整。无需填写孩子生日。"))
      }
      Section(L10n.tr("按年龄选择")) {
        ForEach(AgeViewingPreset.allCases) { preset in
          Button {
            selected = preset
          } label: {
            VStack(alignment: .leading, spacing: 8) {
              Text(preset.title).font(.headline)
              Text(preset.detail).font(.subheadline).foregroundStyle(Color("SupportingText"))
            }.padding(.vertical, 6)
          }.disabled(applying || (preset.sessionSeconds != nil && !ready))
            .accessibilityIdentifier("agePreset-" + preset.rawValue)
        }
        if !ready {
          Text(L10n.tr("这台电视需更新客户端，才能应用带有单次时长限制的预设。"))
            .font(.footnote).foregroundStyle(Color("SupportingText"))
        }
      }
      Section(L10n.tr("这些设置从哪里来")) {
        Text(L10n.tr("世界卫生组织建议：1岁儿童不安排久坐屏幕时间；2至4岁每天不超过1小时，越少越好。"))
        Link(
          L10n.tr("阅读 WHO 幼儿活动与屏幕时间指南"),
          destination: URL(
            string:
              "https://www.who.int/news-room/detail/24-04-2019-to-grow-up-healthy-children-need-to-sit-less-and-play-more"
          )!)
        Text(L10n.tr("美国儿科学会的幼儿媒体建议强调：18个月以下避免使用屏幕（视频通话除外）；18至24个月如开始接触，应选择优质内容并由家长陪同。"))
        Link(
          L10n.tr("阅读 AAP 幼儿媒体使用建议（2016）"),
          destination: URL(
            string:
              "https://publications.aap.org/pediatrics/article/138/5/e20162591/60347/Media-and-Young-Minds"
          )!)
        Text(L10n.tr("澳大利亚卫生部门建议：5至17岁每天的久坐娱乐屏幕时间不超过2小时。"))
        Link(
          L10n.tr("阅读澳大利亚儿童与青少年活动指南"),
          destination: URL(
            string:
              "https://www.health.gov.au/topics/physical-activity-and-exercise/physical-activity-and-exercise-guidelines-for-all-australians/recommendations-for-children-and-young-people-5-to-17-years"
          )!)
      }
      Section {
        Text(
          L10n.tr(
            "18至24个月每天30分钟、每次15分钟和至少休息5分钟是本产品的可选预设，并非上述机构共同规定的标准。预设额度不是建议看满的时间。请把手机、平板等其他屏幕时间也算进去，优先保证睡眠、活动和家人陪伴。"
          )
        )
        .font(.footnote).foregroundStyle(Color("SupportingText"))
      }
    }.navigationTitle(L10n.tr("年龄建议"))
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(L10n.tr("取消")) { dismiss() } }
      }
      .alert(
        L10n.tr("覆盖现有观看设置？"),
        isPresented: Binding(
          get: { selected != nil }, set: { if !$0 { selected = nil } })
      ) {
        if let choice = selected {
          Button(L10n.tr("确认覆盖")) {
            Task {
              applying = true
              defer { applying = false }
              if await onApply(choice.applying(to: policy)) { dismiss() }
            }
          }.accessibilityIdentifier("confirmAgePreset")
        }
        Button(L10n.tr("取消"), role: .cancel) { selected = nil }
      } message: {
        if let selected {
          Text(L10n.tr("将覆盖每日额度、单次观看上限和休息时长。已有休息时段保持不变。\n\(selected.detail)"))
        }
      }
      .familyErrorAlert(inModal: true)
  }
}
