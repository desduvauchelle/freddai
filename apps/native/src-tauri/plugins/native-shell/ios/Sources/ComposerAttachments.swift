import AVFoundation
import ImageIO
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// A file the composer copied into the app's tmp dir. Only this description (never the bytes) crosses to JS;
/// Rust reads `path` and runs the upload to the Mac.
struct AttachedFile: Codable, Equatable {
  let path: String
  let name: String
  let mime: String
  let bytes: Int64

  var isImage: Bool { mime.hasPrefix("image/") }
  var url: URL { URL(fileURLWithPath: path) }
}

enum AttachmentLimits {
  static let maxFiles = 20
  static let maxFileBytes: Int64 = 25 * 1024 * 1024
  static let maxTotalBytes: Int64 = 100 * 1024 * 1024
}

/// Owns `<tmp>/freddai-attachments/<uuid>/<name>`. Rust only uploads from this folder and `discard` only deletes from it.
enum AttachmentStore {
  static let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("freddai-attachments", isDirectory: true)

  private static func folder() throws -> URL {
    let dir = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private static func safeName(_ name: String?, fallbackExtension: String) -> String {
    var base = (name ?? "").replacingOccurrences(of: "/", with: "_").trimmingCharacters(in: .whitespacesAndNewlines)
    if base.isEmpty { base = "Attachment" }
    if (base as NSString).pathExtension.isEmpty, !fallbackExtension.isEmpty { base += "." + fallbackExtension }
    return base
  }

  private static func mime(for name: String, hint: String?) -> String {
    if let hint = hint, !hint.isEmpty { return hint }
    return UTType(filenameExtension: (name as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
  }

  private static func size(of url: URL) -> Int64 {
    Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
  }

  /// Copies a picked file into its own tmp folder. The source may be a temporary file that disappears after the callback.
  static func ingest(_ source: URL, suggestedName: String?, mimeHint: String?) throws -> AttachedFile {
    let name = safeName(suggestedName ?? source.lastPathComponent, fallbackExtension: source.pathExtension)
    let destination = try folder().appendingPathComponent(name)
    try FileManager.default.copyItem(at: source, to: destination)
    return AttachedFile(path: destination.path, name: name, mime: mime(for: name, hint: mimeHint), bytes: size(of: destination))
  }

  static func write(_ data: Data, name: String, mime: String) throws -> AttachedFile {
    let destination = try folder().appendingPathComponent(safeName(name, fallbackExtension: ""))
    try data.write(to: destination)
    return AttachedFile(path: destination.path, name: destination.lastPathComponent, mime: mime, bytes: Int64(data.count))
  }

  static func isManaged(_ url: URL) -> Bool {
    url.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/")
  }

  /// Deletes the tmp copies (and their private folders). Paths outside the attachment folder are ignored.
  static func discard(_ paths: [String]) {
    for path in paths {
      let url = URL(fileURLWithPath: path)
      guard isManaged(url) else { continue }
      let folder = url.deletingLastPathComponent()
      try? FileManager.default.removeItem(at: folder.resolvingSymlinksInPath() == root.resolvingSymlinksInPath() ? url : folder)
    }
  }

  static func exists(_ file: AttachedFile) -> Bool { isManaged(file.url) && FileManager.default.fileExists(atPath: file.path) }
}

/// Presents the photo library, camera and Files pickers and hands back tmp copies.
final class AttachmentPicker: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate, UIDocumentPickerDelegate {
  var present: ((UIViewController) -> Void)?
  var onFiles: (([AttachedFile]) -> Void)?
  var onError: ((String) -> Void)?

  static var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

  func showLibrary(limit: Int) {
    var config = PHPickerConfiguration(photoLibrary: .shared())
    config.selectionLimit = max(1, limit)
    config.filter = .any(of: [.images, .videos])
    // Ask for widely readable formats (JPEG rather than HEIC) so the agent on the Mac can open them.
    config.preferredAssetRepresentationMode = .compatible
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    present?(picker)
  }

  func showCamera() {
    guard Self.cameraAvailable else { return }
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = self
    present?(picker)
  }

  func showFiles() {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
    picker.allowsMultipleSelection = true
    picker.delegate = self
    present?(picker)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard !results.isEmpty else { return }
    let group = DispatchGroup()
    let lock = NSLock()
    var collected: [(Int, AttachedFile)] = []
    var failures = 0
    for (index, result) in results.enumerated() {
      let provider = result.itemProvider
      let types = provider.registeredTypeIdentifiers
      guard let type = types.first(where: { UTType($0)?.conforms(to: .image) == true || UTType($0)?.conforms(to: .movie) == true }) ?? types.first else {
        failures += 1
        continue
      }
      group.enter()
      provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
        defer { group.leave() }
        // The system deletes `url` when this handler returns, so copy it now.
        let file = url.flatMap { try? AttachmentStore.ingest($0, suggestedName: provider.suggestedName, mimeHint: UTType(type)?.preferredMIMEType) }
        lock.lock(); defer { lock.unlock() }
        if let file = file { collected.append((index, file)) } else { failures += 1 }
      }
    }
    group.notify(queue: .main) { [weak self] in
      if !collected.isEmpty { self?.onFiles?(collected.sorted { $0.0 < $1.0 }.map { $0.1 }) }
      if failures > 0 { self?.onError?("\(failures) of the selected items could not be read.") }
    }
  }

  func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    picker.dismiss(animated: true)
    guard let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) else {
      onError?("The photo could not be saved for attaching.")
      return
    }
    let stamp = DateFormatter()
    stamp.dateFormat = "yyyy-MM-dd HH.mm.ss"
    do { onFiles?([try AttachmentStore.write(data, name: "Photo \(stamp.string(from: Date())).jpg", mime: "image/jpeg")]) }
    catch { onError?("The photo could not be saved for attaching.") }
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    var files: [AttachedFile] = []
    var failures = 0
    for url in urls {
      if let file = try? AttachmentStore.ingest(url, suggestedName: nil, mimeHint: nil) { files.append(file) } else { failures += 1 }
    }
    if !files.isEmpty { onFiles?(files) }
    if failures > 0 { onError?("\(failures) of the selected files could not be read.") }
  }
}

/// A removable attachment chip: square thumbnail for images, icon + name for other files.
final class AttachmentChip: UIView {
  private let height: CGFloat = 56
  let filePath: String

  init(file: AttachedFile, onRemove: @escaping () -> Void) {
    filePath = file.path
    super.init(frame: .zero)
    translatesAutoresizingMaskIntoConstraints = false
    layer.cornerRadius = 12
    layer.cornerCurve = .continuous
    clipsToBounds = true
    backgroundColor = .tertiarySystemFill
    heightAnchor.constraint(equalToConstant: height).isActive = true
    isAccessibilityElement = false

    if file.isImage {
      widthAnchor.constraint(equalToConstant: height).isActive = true
      let image = UIImageView()
      image.contentMode = .scaleAspectFill
      image.clipsToBounds = true
      image.translatesAutoresizingMaskIntoConstraints = false
      addSubview(image)
      NSLayoutConstraint.activate([
        image.leadingAnchor.constraint(equalTo: leadingAnchor), image.trailingAnchor.constraint(equalTo: trailingAnchor),
        image.topAnchor.constraint(equalTo: topAnchor), image.bottomAnchor.constraint(equalTo: bottomAnchor),
      ])
      AttachmentChip.thumbnail(for: file.url, maxPixel: 168) { image.image = $0 }
    } else {
      let icon = UIImageView(image: UIImage(systemName: file.mime.hasPrefix("video/") ? "film" : "doc"))
      icon.tintColor = .secondaryLabel
      icon.setContentHuggingPriority(.required, for: .horizontal)
      let label = UILabel()
      label.text = file.name
      label.font = .preferredFont(forTextStyle: .caption1)
      label.textColor = .label
      label.numberOfLines = 2
      label.lineBreakMode = .byTruncatingMiddle
      let row = UIStackView(arrangedSubviews: [icon, label])
      row.axis = .horizontal
      row.alignment = .center
      row.spacing = 6
      row.isUserInteractionEnabled = false
      row.translatesAutoresizingMaskIntoConstraints = false
      addSubview(row)
      NSLayoutConstraint.activate([
        row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10), row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -26),
        row.centerYAnchor.constraint(equalTo: centerYAnchor),
        widthAnchor.constraint(lessThanOrEqualToConstant: 170),
      ])
    }

    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: "xmark.circle.fill")
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 17).applying(UIImage.SymbolConfiguration(paletteColors: [.white, UIColor.black.withAlphaComponent(0.55)]))
    config.contentInsets = NSDirectionalEdgeInsets(top: 3, leading: 3, bottom: 3, trailing: 3)
    let remove = UIButton(configuration: config)
    remove.translatesAutoresizingMaskIntoConstraints = false
    remove.accessibilityLabel = "Remove \(file.name)"
    remove.addAction(UIAction { _ in onRemove() }, for: .touchUpInside)
    addSubview(remove)
    NSLayoutConstraint.activate([
      remove.topAnchor.constraint(equalTo: topAnchor), remove.trailingAnchor.constraint(equalTo: trailingAnchor),
      remove.widthAnchor.constraint(equalToConstant: 28), remove.heightAnchor.constraint(equalToConstant: 28),
    ])
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// Downsamples off the main thread so large photos never stall the composer.
  static func thumbnail(for url: URL, maxPixel: Int, completion: @escaping (UIImage?) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      var image: UIImage?
      if let source = CGImageSourceCreateWithURL(url as CFURL, nil) {
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxPixel]
        image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary).map { UIImage(cgImage: $0) }
      }
      DispatchQueue.main.async { completion(image) }
    }
  }
}
