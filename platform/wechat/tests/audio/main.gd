extends Node2D

var stream_player: AudioStreamPlayer
var sample_player: AudioStreamPlayer
var generator: AudioStreamGenerator
var playback: AudioStreamGeneratorPlayback
var label: Label
var phase := 0.0
var sample_started := false

func _ready() -> void:
	AudioServer.add_bus(1)
	AudioServer.set_bus_name(1, "Sfx")
	AudioServer.set_bus_send(1, "Master")

	generator = AudioStreamGenerator.new()
	generator.mix_rate = 22050.0
	generator.buffer_length = 0.1
	stream_player = AudioStreamPlayer.new()
	stream_player.name = "Stream"
	stream_player.stream = generator
	stream_player.bus = "Master"
	stream_player.volume_db = -8.0
	add_child(stream_player)
	stream_player.play()
	playback = stream_player.get_stream_playback()

	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = 22050
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	var frames := 22050
	wav.loop_end = frames
	var data := PackedByteArray()
	data.resize(frames * 2)
	for i in frames:
		data.encode_s16(i * 2, int(sin(TAU * 660.0 * float(i) / 22050.0) * 12000.0))
	wav.data = data
	sample_player = AudioStreamPlayer.new()
	sample_player.name = "Sample"
	sample_player.stream = wav
	sample_player.playback_type = AudioServer.PLAYBACK_TYPE_SAMPLE
	sample_player.bus = "Sfx"
	sample_player.volume_db = -8.0
	add_child(sample_player)

	label = Label.new()
	label.position = Vector2(24, 24)
	label.size = Vector2(432, 700)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(label)
	_report("ready")

func _process(_delta: float) -> void:
	if playback == null:
		return
	var available := playback.get_frames_available()
	var step := TAU * 440.0 / generator.mix_rate
	for _i in available:
		var value := sin(phase) * 0.2
		playback.push_frame(Vector2(value, value))
		phase += step
	if sample_started:
		_report("playing")

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch and event.pressed:
		_start_sample("tap")

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED:
		_report("paused")
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		if stream_player != null and not stream_player.playing:
			stream_player.play()
			playback = stream_player.get_stream_playback()
		_start_sample("resume")

func _start_sample(reason: String) -> void:
	if sample_player == null:
		return
	sample_started = true
	sample_player.play()
	_report(reason)

func _report(reason: String) -> void:
	var driver := AudioServer.get_driver_name()
	var buses := PackedStringArray()
	for i in AudioServer.get_bus_count():
		buses.append(AudioServer.get_bus_name(i))
	var text := "audio %s\ndriver=%s\nmix=%d latency=%.3f\nbuses=%s\nstream=%s sample=%s\nTap to unlock WeChat audio." % [
		reason,
		driver,
		AudioServer.get_mix_rate(),
		AudioServer.get_output_latency(),
		", ".join(buses),
		"on" if stream_player != null and stream_player.playing else "off",
		"on" if sample_player != null and sample_player.playing else "off",
	]
	print("[Godot] " + text.replace("\n", " | "))
	if label != null:
		label.text = text
