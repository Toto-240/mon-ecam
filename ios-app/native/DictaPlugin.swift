import Foundation
import AVFoundation
import Capacitor

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
    @objc func read(_ call: CAPPluginCall) {
        if !active && !segURLs().isEmpty {
            DispatchQueue.main.async { self.merge { self.readFile(call) } }
            return
        }
        readFile(call)
    }

    private func readFile(_ call: CAPPluginCall) {
        let offset = call.getInt("offset") ?? 0
        let length = call.getInt("length") ?? 1_000_000
        guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
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
        try? FileManager.default.removeItem(at: fileURL)
        segURLs().forEach { try? FileManager.default.removeItem(at: $0) }
        call.resolve()
    }
}
