import UIKit
import Capacitor

/// Branche l'enregistreur natif dans l'appli.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DictaPlugin())
    }
}
