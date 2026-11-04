import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// App Store icon packaging: preserve the existing artwork, encode onto opaque RGB, and leave source assets intact.
let arguments = CommandLine.arguments.dropFirst()
guard let destination = arguments.first else { fatalError("Missing icon catalog directory") }
for path in arguments.dropFirst() {
  let input = URL(fileURLWithPath: path)
  guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
        let context = CGContext(data: nil, width: image.width, height: image.height,
                                bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    fatalError("Cannot decode app icon: \(input.lastPathComponent)")
  }
  let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
  context.setFillColor(CGColor(gray: 1, alpha: 1))
  context.fill(bounds)
  context.draw(image, in: bounds)
  let output = URL(fileURLWithPath: destination).appendingPathComponent(input.lastPathComponent)
  guard let opaque = context.makeImage(),
        let encoder = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    fatalError("Cannot encode app icon: \(input.lastPathComponent)")
  }
  CGImageDestinationAddImage(encoder, opaque, nil)
  guard CGImageDestinationFinalize(encoder) else { fatalError("Cannot write app icon: \(input.lastPathComponent)") }
}
