import StoreKit
import SwiftUI

/// Prices and offer eligibility come from Apple, including storefront currency formatting.
struct SubscriptionPriceView: View {
  let product: Product
  let eligible: Bool
  private var offer: Product.SubscriptionOffer? {
    guard eligible, let offer = product.subscription?.introductoryOffer,
      offer.paymentMode == .payAsYouGo, offer.period.unit == .month,
      offer.period.value == 1, offer.periodCount > 0, offer.price < product.price
    else { return nil }
    return offer
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let offer {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Text(L10n.tr("\(offer.displayPrice) / 月")).font(.title2.bold())
          if let percent = Self.discount(regular: product.price, introductory: offer.price) {
            Text(L10n.tr("优惠约 \(percent)%")).font(.caption.bold())
              .padding(.horizontal, 10).padding(.vertical, 6)
              .foregroundStyle(Color("SuccessText"))
              .background(Color("SuccessText").opacity(0.1), in: Capsule())
          }
        }
        Text(L10n.tr("前 \(offer.periodCount) 个月，每月 \(offer.displayPrice)"))
        Text(L10n.tr("之后每月 \(product.displayPrice)，自动续订。"))
          .font(.footnote).foregroundStyle(Color("SupportingText"))
      } else {
        Text(L10n.tr("\(product.displayPrice) / 月")).font(.title2.bold())
      }
    }
  }
  static func discount(regular: Decimal, introductory: Decimal) -> Int? {
    guard regular > 0, introductory >= 0, introductory < regular else { return nil }
    let amount = NSDecimalNumber(decimal: (1 - introductory / regular) * 100).doubleValue
    return min(100, max(1, Int(amount.rounded())))
  }
}
