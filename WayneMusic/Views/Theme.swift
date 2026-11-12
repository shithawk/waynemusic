import SwiftUI
import UIKit

enum Theme {
    static let background = Color(red: 0.05, green: 0.05, blue: 0.05)
    static let card = Color.white.opacity(0.08)
    static let yellow = Color(red: 1.0, green: 0.82, blue: 0.0)
    static let red = Color(red: 0.86, green: 0.08, blue: 0.1)
    static let carImageName = "Gemini_Generated_Image_68y12568y12568y1"
    static let mirrorHint = "To listen to this on the TV, swipe down from the top-right corner of the iPad, tap Screen Mirroring, then choose the TV."
}

struct CarPhoto: View {
    var body: some View {
        let url = Bundle.main.url(forResource: Theme.carImageName, withExtension: "jpeg")
            ?? Bundle.main.url(forResource: Theme.carImageName, withExtension: "jpg")
        if let url, let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct BigButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title2.weight(.bold))
            .foregroundColor(prominent ? .black : .white)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 80)
            .padding(.horizontal, 12)
            .background(prominent ? Theme.yellow : Theme.red)
            .cornerRadius(18)
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(prominent ? Color.black : Theme.yellow, lineWidth: 3)
            )
            .opacity(configuration.isPressed ? 0.65 : 1)
    }
}
