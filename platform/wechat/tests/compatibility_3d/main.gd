extends Node3D

var frames := 0
var recorded := false
var baseline_after := 0.0
var baseline_recorded := false

func _ready() -> void:
	$Camera3D.look_at(Vector3.ZERO)
	var method := RenderingServer.get_current_rendering_method()
	print("[Godot] compatibility 3d scene camera mesh material light renderer=%s" % method)
	if method != "gl_compatibility":
		push_error("[Godot] compatibility 3d did not draw the lit mesh because renderer is %s. Set rendering/renderer/rendering_method to gl_compatibility." % method)

func _process(_delta: float) -> void:
	frames += 1
	if not recorded and frames >= 45:
		recorded = true
		_report_frame()
	_process_baseline(_delta)

func _report_frame() -> void:
	var viewport := get_viewport()
	var draw_calls := RenderingServer.viewport_get_render_info(viewport.get_viewport_rid(), RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE, RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)
	print("[Godot] compatibility 3d draw_calls=%d" % draw_calls)
	if draw_calls <= 0:
		push_error("[Godot] compatibility 3d did not draw the lit mesh. draw_calls=0. The camera, mesh, material, and light were in the scene but the Compatibility renderer submitted no visible draw. Check the shader log. On iOS enable high-performance mode.")
		return
	var image := viewport.get_texture().get_image()
	if image == null or image.is_empty():
		print("[Godot] compatibility 3d readback unavailable; visual check required")
		baseline_after = 2.0
		return
	if _has_lit_pixel(image):
		print("[Godot] compatibility 3d rendered")
		baseline_after = 2.0
	else:
		push_error("[Godot] compatibility 3d did not draw the lit mesh. The frame has no lit orange pixel. Check the shader log. On iOS enable high-performance mode.")

func _process_baseline(delta: float) -> void:
	if baseline_recorded or baseline_after <= 0.0:
		return
	baseline_after -= delta
	if baseline_after > 0.0:
		return
	baseline_recorded = true
	var fps := Engine.get_frames_per_second()
	var static_memory := OS.get_static_memory_usage()
	var video_mem := Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED)
	print("[Godot] baseline godotFps=%s memoryStatic=%s videoMem=%s guaranteed=false" % [fps, static_memory, video_mem])

func _has_lit_pixel(image: Image) -> bool:
	var step_x := maxi(1, int(image.get_width() / 32.0))
	var step_y := maxi(1, int(image.get_height() / 32.0))
	for y in range(0, image.get_height(), step_y):
		for x in range(0, image.get_width(), step_x):
			var color := image.get_pixel(x, y)
			if color.r > 0.45 and color.g > 0.12 and color.g < 0.8 and color.b < 0.4:
				return true
	return false
