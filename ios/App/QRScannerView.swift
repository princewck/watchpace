import AVFoundation
import SwiftUI
import VisionKit

struct QRScannerView: View {
  var found: (String) -> Void
  @State private var permission: Bool?
  @State private var scannerUnavailable = false
  var body: some View {
    Group {
      if permission == true, !scannerUnavailable, DataScannerViewController.isSupported,
        DataScannerViewController.isAvailable
      {
        CameraScanner(found: found, unavailable: { scannerUnavailable = true }).ignoresSafeArea(
          edges: .bottom)
      } else if permission == false {
        ContentUnavailableView {
          Label(L10n.tr("还不能使用相机"), systemImage: "camera")
        } description: {
          Text(L10n.tr("你可以在手机设置中允许相机，也可以返回后粘贴家人发送的分享链接。"))
        } actions: {
          Button(L10n.tr("打开本 App 设置")) {
            if let url = URL(string: UIApplication.openSettingsURLString) {
              UIApplication.shared.open(url)
            }
          }
        }
      } else if permission == true {
        ContentUnavailableView(
          L10n.tr("这部手机暂时无法扫码"), systemImage: "qrcode",
          description: Text(L10n.tr("请返回后粘贴家人发送的分享链接。")))
      } else {
        ProgressView(L10n.tr("正在打开相机…"))
      }
    }.task {
      permission = await AVCaptureDevice.requestAccess(for: .video)
    }
  }
}
private struct CameraScanner: UIViewControllerRepresentable {
  var found: (String) -> Void
  var unavailable: () -> Void
  func makeCoordinator() -> Coordinator { Coordinator(found: found, unavailable: unavailable) }
  func makeUIViewController(context: Context) -> DataScannerViewController {
    let controller = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced, recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
    controller.delegate = context.coordinator
    do { try controller.startScanning() } catch { DispatchQueue.main.async { unavailable() } }
    return controller
  }
  func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}
  static func dismantleUIViewController(
    _ controller: DataScannerViewController, coordinator: Coordinator
  ) {
    controller.stopScanning()
    controller.delegate = nil
  }
  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let found: (String) -> Void
    var delivered = false
    let unavailable: () -> Void
    init(found: @escaping (String) -> Void, unavailable: @escaping () -> Void) {
      self.found = found
      self.unavailable = unavailable
    }
    func dataScanner(
      _ dataScanner: DataScannerViewController,
      becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
    ) { unavailable() }
    func dataScanner(
      _ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem],
      allItems: [RecognizedItem]
    ) {
      guard !delivered else { return }
      for item in addedItems {
        if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
          delivered = true
          dataScanner.stopScanning()
          found(value)
          return
        }
      }
    }
  }
}
