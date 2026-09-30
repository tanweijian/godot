extends Node3D

var stream_player: AudioStreamPlayer
var sample_player: AudioStreamPlayer
var generator: AudioStreamGenerator
var playback: AudioStreamGeneratorPlayback
var label: Label
var http: HTTPRequest
var socket: WebSocketPeer
var lines: PackedStringArray = []
var phase := 0.0
var socket_sent := false
var started_ms := 0
var frames := 0
var pixels_checked := false
var baseline_after := 0.0
var baseline_recorded := false
var pause_count := 0
var resume_count := 0
var foreground := true

func _ready() -> void:
	started_ms = Time.get_ticks_msec()
	label = $Overlay/Report
	_line("startup")
	_line("os name=%s model=%s version=%s" % [OS.get_name(), OS.get_model_name(), OS.get_version()])
	var method := RenderingServer.get_current_rendering_method()
	_line("renderer=%s" % method)
	if method != "gl_compatibility":
		_fail("renderer", method)
	_check_files()
	_start_audio()
	_start_network()
	_load_subpackage()
	_show()

func _process(delta: float) -> void:
	frames += 1
	_feed_stream()
	_poll_socket()
	if not pixels_checked and frames >= 45:
		pixels_checked = true
		_check_frame()
	if baseline_recorded or baseline_after <= 0.0:
		return
	baseline_after -= delta
	if baseline_after > 0.0:
		return
	baseline_recorded = true
	_line("baseline godotFps=%s memoryStatic=%s videoMem=%s guaranteed=false" % [
		Engine.get_frames_per_second(),
		OS.get_static_memory_usage(),
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED),
	])
	_show()

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch and event.pressed:
		_line("touch index=%s position=%s" % [event.index, event.position])
		_unlock_audio("tap")

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED:
		foreground = false
		pause_count += 1
		_line("paused count=%s foreground=%s" % [pause_count, foreground])
		_report_audio("paused")
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		foreground = true
		resume_count += 1
		_line("resumed count=%s" % resume_count)
		_report_audio("resumed")

func _check_files() -> void:
	var marker := FileAccess.get_file_as_string("res://marker.txt").strip_edges()
	var menu := FileAccess.get_file_as_string("res://ui/menu.txt").strip_edges()
	_line("res read marker=%s menu=%s" % [marker, menu])
	var res_write := FileAccess.open("res://marker.txt", FileAccess.WRITE)
	if res_write != null:
		res_write.store_string("mutated")
		res_write.close()
		_fail("res write", "unexpectedly succeeded")
	else:
		_line("res write error=%s" % error_string(FileAccess.get_open_error()))
	_line("res read after=%s" % FileAccess.get_file_as_string("res://marker.txt").strip_edges())
	var before := ""
	if FileAccess.file_exists("user://save.dat"):
		before = FileAccess.get_file_as_string("user://save.dat").strip_edges()
	_line("user read before=%s" % before)
	var save := FileAccess.open("user://save.dat", FileAccess.WRITE)
	if save == null:
		_fail("user write", error_string(FileAccess.get_open_error()))
	else:
		var next := "persist-1" if before.is_empty() else "persist-2"
		save.store_string(next)
		save.close()
		_line("user read after=%s" % FileAccess.get_file_as_string("user://save.dat").strip_edges())
	var missing := FileAccess.open("user://missing.dat", FileAccess.READ)
	if missing != null:
		missing.close()
		_fail("missing", "unexpectedly opened")
	else:
		_line("missing error=%s" % error_string(FileAccess.get_open_error()))

func _load_subpackage() -> void:
	var boss_before := FileAccess.file_exists("res://levels/boss.txt")
	_line("subpackage before exists=%s" % boss_before)
	if boss_before:
		_fail("subpackage", "boss.txt was readable before the levels package loaded")
	if not Engine.has_singleton("WeChat"):
		_fail("subpackage", "WeChat singleton is missing")
		return
	var wechat := Engine.get_singleton("WeChat")
	wechat.resource_subpackage_progress.connect(_on_subpackage_progress)
	wechat.resource_subpackage_loaded.connect(_on_subpackage_loaded)
	wechat.resource_subpackage_failed.connect(_on_subpackage_failed)
	var err: int = wechat.load_resource_subpackage("levels")
	_line("subpackage start %s" % error_string(err))

func _on_subpackage_progress(package_name: String, progress: float) -> void:
	_line("subpackage progress %s %s" % [package_name, progress])
	_show()

func _on_subpackage_loaded(package_name: String) -> void:
	var boss := FileAccess.get_file_as_string("res://levels/boss.txt").strip_edges()
	_line("subpackage loaded %s boss=%s" % [package_name, boss])
	_show()

func _on_subpackage_failed(package_name: String, message: String) -> void:
	_fail("subpackage %s" % package_name, message)
	_show()

func _start_network() -> void:
	http = HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(_on_http)
	_line("http start %s" % error_string(http.request("https://www.qq.com/")))
	socket = WebSocketPeer.new()
	_line("socket start %s" % error_string(socket.connect_to_url("wss://ws.postman-echo.com/raw")))

func _on_http(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	var text := body.get_string_from_utf8()
	_line("http result=%s code=%s bytes=%s head=%s" % [result, code, body.size(), text.substr(0, 40).replace("\n", " ")])
	_show()

func _poll_socket() -> void:
	if socket == null or socket_sent and _has_line_prefix("socket message"):
		return
	socket.poll()
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not socket_sent:
			_line("socket open")
			socket.send_text("ping")
			socket_sent = true
		while socket.get_available_packet_count() > 0:
			_line("socket message %s" % socket.get_packet().get_string_from_utf8())
	elif state == WebSocketPeer.STATE_CLOSED and socket.get_close_code() != -1:
		_line("socket closed code=%s reason=%s" % [socket.get_close_code(), socket.get_close_reason()])
		socket = null
	elif Time.get_ticks_msec() - started_ms > 12000 and not socket_sent:
		_line("socket timeout state=%s code=%s reason=%s" % [state, socket.get_close_code(), socket.get_close_reason()])
		socket = null
	if socket == null or _has_line_prefix("socket message"):
		_show()

func _start_audio() -> void:
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
	stream_player.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
	add_child(stream_player)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = 22050
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	var frames_in_sample := 22050
	wav.loop_end = frames_in_sample
	var data := PackedByteArray()
	data.resize(frames_in_sample * 2)
	for i in frames_in_sample:
		data.encode_s16(i * 2, int(sin(TAU * 660.0 * float(i) / 22050.0) * 12000.0))
	wav.data = data
	sample_player = AudioStreamPlayer.new()
	sample_player.name = "Sample"
	sample_player.stream = wav
	sample_player.playback_type = AudioServer.PLAYBACK_TYPE_SAMPLE
	sample_player.bus = "Sfx"
	sample_player.volume_db = -8.0
	add_child(sample_player)
	_report_audio("ready")

func _feed_stream() -> void:
	if playback == null:
		return
	var available := playback.get_frames_available()
	var step := TAU * 440.0 / generator.mix_rate
	for _i in available:
		playback.push_frame(Vector2(sin(phase) * 0.2, sin(phase) * 0.2))
		phase += step

func _unlock_audio(reason: String) -> void:
	if stream_player != null and not stream_player.playing:
		stream_player.play()
		playback = stream_player.get_stream_playback()
	if sample_player == null:
		_report_audio(reason)
		return
	sample_player.play()
	_report_audio(reason)

func _report_audio(reason: String) -> void:
	var buses := PackedStringArray()
	for i in AudioServer.get_bus_count():
		buses.append(AudioServer.get_bus_name(i))
	var stream_state := "off"
	if stream_player != null and stream_player.playing:
		stream_state = "on"
	var sample_state := "off"
	if sample_player != null and sample_player.playing:
		sample_state = "on"
	var text := "audio %s driver=%s buses=%s stream=%s sample=%s" % [
		reason,
		AudioServer.get_driver_name(),
		", ".join(buses),
		stream_state,
		sample_state,
	]
	_line(text + " tone=440Hz+660Hz heard=unconfirmed")
	_show()

func _check_frame() -> void:
	var window_size := DisplayServer.window_get_size()
	var safe := DisplayServer.get_display_safe_area()
	_line("display window=%s x %s scale=%s safe=%s" % [
		window_size.x,
		window_size.y,
		DisplayServer.screen_get_scale(),
		safe,
	])
	var viewport := get_viewport()
	var visible := RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE
	var draw_item := RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME
	var draw_calls := RenderingServer.viewport_get_render_info(
		viewport.get_viewport_rid(),
		visible,
		draw_item
	)
	_line("draw_calls=%s" % draw_calls)
	if draw_calls <= 0:
		_fail("frame", "draw_calls=0")
		_show()
		return
	var image := viewport.get_texture().get_image()
	if image == null or image.is_empty():
		_line("pixels readback=unavailable")
		baseline_after = 2.0
		_show()
		return
	_line("pixels orange=%s green=%s" % [_has_orange(image), _has_green(image)])
	baseline_after = 2.0
	_show()

func _has_orange(image: Image) -> bool:
	return _has_pixel(image, func(color: Color) -> bool:
		return color.r > 0.45 and color.g > 0.12 and color.g < 0.8 and color.b < 0.4
	)

func _has_green(image: Image) -> bool:
	return _has_pixel(image, func(color: Color) -> bool:
		return color.g > 0.45 and color.g > color.r + 0.2 and color.g > color.b
	)

func _has_pixel(image: Image, match: Callable) -> bool:
	var step_x := maxi(1, int(image.get_width() / 32.0))
	var step_y := maxi(1, int(image.get_height() / 32.0))
	for y in range(0, image.get_height(), step_y):
		for x in range(0, image.get_width(), step_x):
			if match.call(image.get_pixel(x, y)):
				return true
	return false

func _has_line_prefix(prefix: String) -> bool:
	for line in lines:
		if line.begins_with(prefix):
			return true
	return false

func _fail(area: String, detail: String) -> void:
	_line("fail %s %s" % [area, detail])

func _line(text: String) -> void:
	lines.append(text)
	print("[Godot] acceptance " + text)

func _show() -> void:
	var report := "\n".join(lines)
	if label != null:
		label.text = report
	var file := FileAccess.open("user://acceptance-report.txt", FileAccess.WRITE)
	if file != null:
		file.store_string(report)
		file.close()
