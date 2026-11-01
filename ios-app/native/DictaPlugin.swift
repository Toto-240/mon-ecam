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
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
    ]

    private var recorder: AVAudioRecorder?
    private var observing = false

    private var fileURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("cours-en-cours.m4a")
    }

    private func fileSize() -> Int {
        let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        return (attrs?[.size] as? NSNumber)?.intValue ?? 0
    }

    @objc func start(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { call.reject("Accès au micro refusé"); return }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playAndRecord, mode: .default,
                                            options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
                    try session.setActive(true)
                    try? FileManager.default.removeItem(at: self.fileURL)
                    let settings: [String: Any] = [
                        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                        AVSampleRateKey: 16000,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderBitRateKey: 32000,
                    ]
                    let r = try AVAudioRecorder(url: self.fileURL, settings: settings)
                    guard r.record() else { call.reject("Impossible de démarrer l'enregistrement"); return }
                    self.recorder = r
                    self.watchInterruptions()
                    call.resolve(["ok": true])
                } catch {
                    call.reject("Erreur du micro : \(error.localizedDescription)")
                }
            }
        }
    }

    /// Après un appel ou une alarme, l'enregistrement reprend tout seul.
    private func watchInterruptions() {
        guard !observing else { return }
        observing = true
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
                                               object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .ended,
                  let r = self?.recorder else { return }
            try? AVAudioSession.sharedInstance().setActive(true)
            r.record()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.recorder?.stop()
            self.recorder = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            call.resolve(["size": self.fileSize()])
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "recording": self.recorder != nil,
                "seconds": self.recorder?.currentTime ?? 0,
                "size": self.fileSize(),
            ])
        }
    }

    /// Lit le fichier par morceaux (base64) pour l'envoyer depuis la page.
    @objc func read(_ call: CAPPluginCall) {
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

    @objc func discard(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: fileURL)
        call.resolve()
    }
}
