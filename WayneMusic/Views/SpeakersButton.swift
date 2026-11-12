import AVKit
import SwiftUI

struct SpeakersButton: View {
    var body: some View {
        ZStack {
            RoutePicker()
            HStack(spacing: 16) {
                Image(systemName: "hifispeaker.fill")
                    .font(.title)
                Text("Speakers")
                    .font(.title2.weight(.bold))
                Spacer()
            }
            .foregroundColor(.white)
            .padding(.horizontal, 24)
            .allowsHitTesting(false)
        }
        .frame(minHeight: 80)
        .background(Color.white.opacity(0.14))
        .cornerRadius(18)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.white, lineWidth: 2)
        )
        .accessibilityLabel("Speakers")
        .accessibilityHint("Choose where the sound plays")
    }
}

private struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let picker = AVRoutePickerView()
        picker.tintColor = .clear
        picker.activeTintColor = .clear
        picker.prioritizesVideoDevices = false
        return picker
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
