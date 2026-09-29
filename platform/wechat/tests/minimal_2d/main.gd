extends Node2D

var status: Label
var touches := {}
var pause_count := 0
var resume_count := 0
var foreground := true

func _ready() -> void:
	status = Label.new()
	status.position = Vector2(24, 24)
	status.size = Vector2(432, 220)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(status)
	print("[Godot] touch display lifecycle demo")
	_refresh_status()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED:
		foreground = false
		pause_count += 1
		print("[Godot] application paused count=%d" % pause_count)
		_refresh_status()
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		foreground = true
		resume_count += 1
		print("[Godot] application resumed count=%d" % resume_count)
		_refresh_status()

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			touches[event.index] = event.position
			print("[Godot] touch down index=%d position=%s" % [event.index, event.position])
		else:
			touches.erase(event.index)
			print("[Godot] touch up index=%d position=%s" % [event.index, event.position])
		_refresh_status()
		queue_redraw()
	elif event is InputEventScreenDrag:
		touches[event.index] = event.position
		queue_redraw()

func _process(_delta: float) -> void:
	_refresh_status()
	queue_redraw()

func _refresh_status() -> void:
	if status == null:
		return
	var window_size := DisplayServer.window_get_size()
	var screen_size := DisplayServer.screen_get_size()
	var scale := DisplayServer.screen_get_scale()
	var safe := DisplayServer.get_display_safe_area()
	var touch_text := "touches none"
	if not touches.is_empty():
		var parts: PackedStringArray = []
		for index in touches:
			parts.append("%s:%s" % [index, touches[index]])
		touch_text = " ".join(parts)
	status.text = "window %s x %s\nscreen %s x %s  scale %s\nsafe %s\n%s  pauses %d  resumes %d\n%s" % [
		window_size.x, window_size.y,
		screen_size.x, screen_size.y, scale,
		safe,
		"foreground" if foreground else "background", pause_count, resume_count,
		touch_text,
	]

func _draw() -> void:
	var safe := _safe_viewport_rect()
	draw_rect(safe, Color(0.95, 0.78, 0.2, 0.9), false, 3.0)
	for index in touches:
		draw_circle(touches[index], 18.0, Color(0.95, 0.35, 0.25, 0.9))

func _safe_viewport_rect() -> Rect2:
	var safe := DisplayServer.get_display_safe_area()
	var to_viewport := get_viewport().get_screen_transform().affine_inverse()
	var origin := to_viewport * Vector2(safe.position)
	var corner := to_viewport * Vector2(safe.position + safe.size)
	return Rect2(origin, corner - origin)
