/**
 * 録音用の AudioWorklet。入力の Float32 を、加工せずそのままメインスレッドへ送る。
 *
 * `audioContext.audioWorklet.addModule("/voice/pcm-worklet.js")` で読み込む。
 * このファイルはブラウザが直接読み、バンドラを通さないため import 文を書かない。
 * ゲイン・フィルタ・無音判定は載せない（後段でまとめて決める）。
 *
 * 送る形は channelData[0] の Float32Array。AudioWorklet の入力バッファは次の
 * 描画で再利用されるため、必ずコピーしてから送る。
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      // 入力がまだ繋がっていない。processor は止めずに待つ。
      return true;
    }
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // 128 フレームずつ届く。コピーしないと次の process で中身が変わる。
    this.port.postMessage(channel.slice(0));
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
