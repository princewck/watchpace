import Foundation
import ImageIO
import UniformTypeIdentifiers

enum RestPhotoPackage {
  static func prepare(_ data: Data) throws -> Data {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let rawWidth = info[kCGImagePropertyPixelWidth] as? Int,
      let rawHeight = info[kCGImagePropertyPixelHeight] as? Int
    else { throw TVError.message(L10n.tr("无法读取这张照片。")) }
    let rotated = (5...8).contains(info[kCGImagePropertyOrientation] as? Int ?? 1)
    let width = rotated ? rawHeight : rawWidth
    let height = rotated ? rawWidth : rawHeight
    guard width > height, width > 2048, height >= 1080,
      let image = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 3840,
        ] as CFDictionary),
      image.width > 2048, image.height >= 1080
    else { throw TVError.message(L10n.tr("请选择宽度超过 2048 像素、高度至少 1080 像素的横屏照片，推荐 16:9。")) }

    // Re-encode pixels only so location and other original metadata are not sent.
    for quality in [0.84, 0.72, 0.60, 0.48] {
      let output = NSMutableData()
      guard
        let destination = CGImageDestinationCreateWithData(
          output, UTType.jpeg.identifier as CFString, 1, nil)
      else { break }
      CGImageDestinationAddImage(
        destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
      if CGImageDestinationFinalize(destination), output.length <= 2 * 1024 * 1024 {
        return output as Data
      }
    }
    throw TVError.message(L10n.tr("照片文件太大，请换一张照片。"))
  }
}
