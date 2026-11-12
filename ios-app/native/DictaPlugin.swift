import Foundation
import AVFoundation
import Capacitor
import WebKit

/// Enregistreur natif : continue écran verrouillé (mode audio en arrière-plan).
@objc(DictaPlugin)
public class DictaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DictaPlugin"
    public let jsName = "Dicta"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "park", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queued", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pdfHtml", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "savePdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    private var recorder: AVAudioRecorder?
    private var observing = false
    private var active = false        // un enregistrement est en cours (même en pause)
    private var userPaused = false    // mis en pause par l'étudiant : ne pas reprendre après un appel
    private var doneSeconds: Double = 0   // durée des morceaux déjà terminés
    private var segIndex = 0

    /*  Chaque reprise après une pause écrit un nouveau morceau (seg-N.m4a) avec un micro neuf :
        un enregistreur laissé en pause pendant que l'appli dort en arrière-plan peut « reprendre »
        sans plus rien capter. À la fin, les morceaux sont recollés dans cours-en-cours.m4a. */

    private var docs: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    private var fileURL: URL { docs.appendingPathComponent("cours-en-cours.m4a") }
    private func segURL(_ i: Int) -> URL { docs.appendingPathComponent(String(format: "seg-%04d.m4a", i)) }

    private func segURLs() -> [URL] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: docs.path)) ?? []
        return names.filter { $0.hasPrefix("seg-") && $0.hasSuffix(".m4a") }.sorted().map { docs.appendingPathComponent($0) }
    }

    private func size(_ url: URL) -> Int {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.size] as? NSNumber)?.intValue ?? 0
    }

    private func fileSize() -> Int {
        size(fileURL) + segURLs().reduce(0) { $0 + size($1) }
    }

    private func prepareSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
        try session.setActive(true)
    }

    /// Démarre un nouveau morceau avec un enregistreur neuf.
    private func startSegment() throws {
        try prepareSession()
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32000,
        ]
        segIndex += 1
        let r = try AVAudioRecorder(url: segURL(segIndex), settings: settings)
        guard r.record() else { throw NSError(domain: "Dicta", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Impossible de démarrer le micro"]) }
        recorder = r
    }

    /// Termine proprement le morceau en cours (le fichier devient lisible).
    private func endSegment() {
        guard let r = recorder else { return }
        doneSeconds += r.currentTime
        r.stop()
        recorder = nil
    }

    private var currentSeconds: Double { doneSeconds + (recorder?.currentTime ?? 0) }

    @objc func start(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { call.reject("Accès au micro refusé"); return }
                self.endSegment()
                try? FileManager.default.removeItem(at: self.fileURL)
                self.segURLs().forEach { try? FileManager.default.removeItem(at: $0) }
                self.segIndex = 0
                self.doneSeconds = 0
                do {
                    try self.startSegment()
                    self.active = true
                    self.userPaused = false
                    self.watchInterruptions()
                    call.resolve(["ok": true])
                } catch {
                    call.reject("Erreur du micro : \(error.localizedDescription)")
                }
            }
        }
    }

    /// Après un appel ou une alarme, l'enregistrement reprend tout seul ; en revenant dans l'appli,
    /// si le micro s'est arrêté sans pause demandée, il est relancé.
    private func watchInterruptions() {
        guard !observing else { return }
        observing = true
        let nc = NotificationCenter.default
        nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, self.active, !self.userPaused,
                  let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            if let r = self.recorder, r.record() { return }
            self.endSegment()
            try? self.startSegment()
        }
        nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self = self, self.active, !self.userPaused else { return }
            self.endSegment()
            try? self.startSegment()
        }
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.heal()
        }
    }

    /// Relance le micro s'il devrait enregistrer mais ne le fait plus.
    private func heal() {
        guard active, !userPaused, !(recorder?.isRecording ?? false) else { return }
        endSegment()
        try? startSegment()
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.active else { call.reject("Aucun enregistrement en cours"); return }
            self.endSegment()   // morceau terminé et rangé : rien ne reste « en pause » pendant que l'appli dort
            self.userPaused = true
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.resolve(["seconds": self.currentSeconds])
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.active else { call.reject("Aucun enregistrement en cours"); return }
            self.endSegment()
            do { try self.startSegment() } catch {
                call.reject("Impossible de reprendre : \(error.localizedDescription)"); return
            }
            self.userPaused = false
            // vérification : le micro capte-t-il vraiment ? Sinon, deuxième essai avec une session remise à zéro.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                if let r = self.recorder, r.isRecording, r.currentTime > 0.2 {
                    call.resolve(["seconds": self.currentSeconds, "live": true]); return
                }
                self.endSegment()
                try? AVAudioSession.sharedInstance().setActive(false)
                do { try self.startSegment() } catch {
                    call.reject("Le micro ne répond pas : \(error.localizedDescription)"); return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    let ok = self.recorder?.isRecording ?? false
                    if ok { call.resolve(["seconds": self.currentSeconds, "live": true]) }
                    else { call.reject("Le micro ne répond pas. Appuie sur Terminer : ce qui a été enregistré est gardé.") }
                }
            }
        }
    }

    /// Recolle les morceaux dans cours-en-cours.m4a (morceaux illisibles ignorés).
    private func merge(_ done: @escaping () -> Void) {
        let segs = segURLs()
        if segs.isEmpty { done(); return }
        let fm = FileManager.default
        if segs.count == 1 && !fm.fileExists(atPath: fileURL.path) {
            try? fm.moveItem(at: segs[0], to: fileURL); done(); return
        }
        let inputs = (fm.fileExists(atPath: fileURL.path) ? [fileURL] : []) + segs
        let comp = AVMutableComposition()
        guard let track = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            done(); return
        }
        var cursor = CMTime.zero
        for url in inputs {
            let asset = AVURLAsset(url: url)
            guard let t = asset.tracks(withMediaType: .audio).first, asset.duration.seconds > 0 else { continue }
            do {
                try track.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: t, at: cursor)
                cursor = cursor + asset.duration
            } catch { continue }
        }
        guard cursor.seconds > 0 else { done(); return }
        let out = docs.appendingPathComponent("assemblage.m4a")
        try? fm.removeItem(at: out)
        func export(_ preset: String, _ fallback: (() -> Void)?) {
            guard let ex = AVAssetExportSession(asset: comp, presetName: preset) else {
                if let f = fallback { f() } else { done() }
                return
            }
            ex.outputURL = out
            ex.outputFileType = .m4a
            ex.exportAsynchronously {
                DispatchQueue.main.async {
                    if ex.status == .completed {
                        inputs.forEach { try? fm.removeItem(at: $0) }
                        try? fm.moveItem(at: out, to: self.fileURL)
                        done()
                    } else {
                        try? fm.removeItem(at: out)
                        if let f = fallback { f() } else { done() }
                    }
                }
            }
        }
        export(AVAssetExportPresetPassthrough) { export(AVAssetExportPresetAppleM4A, nil) }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endSegment()
            self.active = false
            self.userPaused = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self.merge { call.resolve(["size": self.fileSize(), "seconds": self.doneSeconds]) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "recording": self.active,
                "paused": self.active && self.userPaused,
                "live": self.recorder?.isRecording ?? false,
                "seconds": self.currentSeconds,
                "size": self.fileSize(),
            ])
        }
    }

    /// Lit le fichier par morceaux (base64) pour l'envoyer depuis la page.
    /// Imprime la page affichée (mise en page d'impression préparée par print.js) : fenêtre d'impression
    /// d'iOS, avec AirPrint et « Enregistrer dans Fichiers » / partage en PDF.
    @objc func printPage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else { call.reject("Page introuvable"); return }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("title") ?? "Mon ECAM"
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printFormatter = webView.viewPrintFormatter()
            let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["printed": completed]) }
            }
            if UIDevice.current.userInterfaceIdiom == .pad, let view = self.bridge?.viewController?.view {
                pc.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true, completionHandler: done)
            } else {
                pc.present(animated: true, completionHandler: done)
            }
        }
    }

    /// Imprime un document HTML complet préparé par print.js, dans une page à part (invisible) :
    /// l'appli peut se redessiner pendant l'aperçu sans le faire disparaître.
    private var printView: WKWebView?
    private var printLoader: PrintLoader?

    @objc func printHtml(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let html = call.getString("html"), let host = self.bridge?.viewController?.view else {
                call.reject("Document vide"); return
            }
            self.printView?.removeFromSuperview()
            let wv = WKWebView(frame: CGRect(x: -2000, y: 0, width: 794, height: 1123))
            wv.isUserInteractionEnabled = false
            host.addSubview(wv)   // hors de l'écran, mais dans la fenêtre (sinon l'impression est blanche)
            let loader = PrintLoader { [weak self] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    guard let self = self else { return }
                    let info = UIPrintInfo(dictionary: nil)
                    info.outputType = .general
                    info.jobName = call.getString("title") ?? "Mon ECAM"
                    let pc = UIPrintInteractionController.shared
                    pc.printInfo = info
                    pc.printFormatter = wv.viewPrintFormatter()
                    let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
                        wv.removeFromSuperview()
                        self.printView = nil
                        self.printLoader = nil
                        if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["printed": completed]) }
                    }
                    if UIDevice.current.userInterfaceIdiom == .pad {
                        pc.present(from: CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 1, height: 1), in: host, animated: true, completionHandler: done)
                    } else {
                        pc.present(animated: true, completionHandler: done)
                    }
                }
            }
            wv.navigationDelegate = loader
            self.printView = wv
            self.printLoader = loader
            wv.loadHTMLString(html, baseURL: nil)
        }
    }

    /// Fabrique un vrai PDF A4 (pages découpées) à partir du document de print.js, puis ouvre la feuille
    /// de partage d'iOS : Imprimer, Enregistrer dans Fichiers, AirDrop… Sans l'aperçu d'impression.
    @objc func pdfHtml(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let html = call.getString("html"), let vc = self.bridge?.viewController, let host = vc.view else {
                call.reject("Document vide"); return
            }
            self.printView?.removeFromSuperview()
            let wv = WKWebView(frame: CGRect(x: -2000, y: 0, width: 794, height: 1123))
            wv.isUserInteractionEnabled = false
            host.addSubview(wv)
            let loader = PrintLoader { [weak self] in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    guard let self = self else { return }
                    let page = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)          // A4 en points
                    let renderer = UIPrintPageRenderer()
                    renderer.addPrintFormatter(wv.viewPrintFormatter(), startingAtPageAt: 0)
                    renderer.setValue(NSValue(cgRect: page), forKey: "paperRect")
                    renderer.setValue(NSValue(cgRect: page.insetBy(dx: 40, dy: 44)), forKey: "printableRect")
                    let data = NSMutableData()
                    UIGraphicsBeginPDFContextToData(data, page, nil)
                    let n = renderer.numberOfPages
                    renderer.prepare(forDrawingPages: NSRange(location: 0, length: max(n, 1)))
                    for i in 0..<n {
                        UIGraphicsBeginPDFPage()
                        renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
                    }
                    UIGraphicsEndPDFContext()
                    wv.removeFromSuperview()
                    self.printView = nil
                    self.printLoader = nil
                    guard n > 0 else { call.reject("Document vide"); return }
                    let raw = (call.getString("name") ?? "Mon ECAM").replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
                    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("partage", isDirectory: true)
                    try? FileManager.default.removeItem(at: dir)
                    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    let url = dir.appendingPathComponent(raw.hasSuffix(".pdf") ? raw : "\(raw).pdf")
                    do { try data.write(to: url, options: .atomic) } catch { call.reject("Écriture impossible"); return }
                    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                    if let pop = sheet.popoverPresentationController {   // iPad
                        pop.sourceView = host
                        pop.sourceRect = CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 0, height: 0)
                        pop.permittedArrowDirections = []
                    }
                    sheet.completionWithItemsHandler = { _, done, _, _ in call.resolve(["ok": done, "pages": n]) }
                    vc.present(sheet, animated: true)
                }
            }
            wv.navigationDelegate = loader
            self.printView = wv
            self.printLoader = loader
            wv.loadHTMLString(html, baseURL: nil)
        }
    }

    /// Range un PDF dans l'app Fichiers (Sur mon iPhone › Mon ECAM › Impressions), sans aucune fenêtre.
    @objc func savePdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("Fichier vide"); return }
        var name = (call.getString("name") ?? "Mon ECAM.pdf").replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
        let dir = docs.appendingPathComponent("Impressions", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir.appendingPathComponent(name)
        var k = 2
        while FileManager.default.fileExists(atPath: url.path) {   // ne jamais écraser un PDF déjà enregistré
            url = dir.appendingPathComponent("\(String(name.dropLast(4))) (\(k)).pdf"); k += 1
        }
        do { try data.write(to: url, options: .atomic) } catch { call.reject("Écriture impossible : \(error.localizedDescription)"); return }
        call.resolve(["name": url.lastPathComponent])
    }

    /* File d'attente : les enregistrements pas encore envoyés sont mis de côté dans Documents/attente/<id>.m4a
       (un nouvel enregistrement n'écrase plus l'ancien). */
    private var queueDir: URL { docs.appendingPathComponent("attente", isDirectory: true) }
    private func queuedURL(_ id: String) -> URL? {
        let clean = id.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return clean.isEmpty ? nil : queueDir.appendingPathComponent("\(clean).m4a")
    }

    /// Met de côté l'enregistrement terminé (non envoyé) sous son identifiant.
    @objc func park(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.active else { call.reject("Un enregistrement est en cours"); return }
            guard let dest = self.queuedURL(call.getString("id") ?? "") else { call.reject("Identifiant manquant"); return }
            self.merge {
                let fm = FileManager.default
                guard fm.fileExists(atPath: self.fileURL.path) else { call.resolve(["size": 0]); return }
                try? fm.createDirectory(at: self.queueDir, withIntermediateDirectories: true)
                try? fm.removeItem(at: dest)
                do {
                    try fm.moveItem(at: self.fileURL, to: dest)
                    call.resolve(["size": self.size(dest)])
                } catch {
                    call.reject("Impossible de mettre l'enregistrement de côté : \(error.localizedDescription)")
                }
            }
        }
    }

    /// Liste des enregistrements mis de côté : [{ id, size }].
    @objc func queued(_ call: CAPPluginCall) {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: queueDir.path)) ?? []
        let items = names.filter { $0.hasSuffix(".m4a") }.sorted().map { name -> [String: Any] in
            ["id": String(name.dropLast(4)), "size": size(queueDir.appendingPathComponent(name))]
        }
        call.resolve(["items": items])
    }

    @objc func read(_ call: CAPPluginCall) {
        if let id = call.getString("id"), let url = queuedURL(id) {
            readFile(call, url); return
        }
        if !active && !segURLs().isEmpty {
            DispatchQueue.main.async { self.merge { self.readFile(call, self.fileURL) } }
            return
        }
        readFile(call, fileURL)
    }

    private func readFile(_ call: CAPPluginCall, _ url: URL) {
        let offset = call.getInt("offset") ?? 0
        let length = call.getInt("length") ?? 1_000_000
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            call.reject("Enregistrement introuvable"); return
        }
        defer { try? handle.close() }
        handle.seek(toFileOffset: UInt64(offset))
        let data = handle.readData(ofLength: length)
        call.resolve(["data": data.base64EncodedString(), "eof": data.count < length])
    }

    /// Enregistre un fichier (devoir Word / PDF) : feuille de partage iOS
    /// (Enregistrer dans Fichiers, ouvrir dans Word, AirDrop…).
    @objc func share(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("Fichier vide"); return
        }
        let raw = call.getString("name") ?? "devoir"
        let name = raw.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("partage", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        do { try data.write(to: url) } catch { call.reject("Écriture impossible"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("Affichage impossible"); return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {   // iPad
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, done, _, _ in call.resolve(["ok": done]) }
            vc.present(sheet, animated: true)
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        if let id = call.getString("id"), let url = queuedURL(id) {
            try? FileManager.default.removeItem(at: url)
            call.resolve(); return
        }
        try? FileManager.default.removeItem(at: fileURL)
        segURLs().forEach { try? FileManager.default.removeItem(at: $0) }
        call.resolve()
    }
}


/// Prévient quand la page à imprimer a fini de charger.
final class PrintLoader: NSObject, WKNavigationDelegate {
    private let onLoad: () -> Void
    private var fired = false
    init(onLoad: @escaping () -> Void) { self.onLoad = onLoad }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !fired else { return }
        fired = true
        onLoad()
    }
}
