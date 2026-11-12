import SwiftUI

enum Theme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let card = Color.white.opacity(0.10)
    static let mirrorHint = "To see this on the TV, swipe down from the top-right corner of the iPad, tap Screen Mirroring, then choose the TV."
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
            .background(prominent ? Color.white : Color.white.opacity(0.14))
            .cornerRadius(18)
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(prominent ? 0 : 0.95), lineWidth: prominent ? 0 : 2)
            )
            .opacity(configuration.isPressed ? 0.65 : 1)
    }
}
