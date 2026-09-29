extends Node2D

func _ready() -> void:
	var lines: PackedStringArray = []
	var marker := FileAccess.get_file_as_string("res://marker.txt").strip_edges()
	lines.append("res read marker=%s" % marker)
	var res_write := FileAccess.open("res://marker.txt", FileAccess.WRITE)
	if res_write != null:
		res_write.store_string("mutated")
		res_write.close()
		lines.append("res write unexpectedly succeeded")
	else:
		lines.append("res write error=%s" % error_string(FileAccess.get_open_error()))
	var marker_after := FileAccess.get_file_as_string("res://marker.txt").strip_edges()
	lines.append("res read after=%s" % marker_after)

	var before := ""
	if FileAccess.file_exists("user://save.dat"):
		before = FileAccess.get_file_as_string("user://save.dat").strip_edges()
	lines.append("user read before=%s" % before)
	var save := FileAccess.open("user://save.dat", FileAccess.WRITE)
	if save == null:
		lines.append("user write error=%s" % error_string(FileAccess.get_open_error()))
	else:
		var next := "persist-1" if before.is_empty() else "persist-2"
		save.store_string(next)
		save.close()
		lines.append("user read after=%s" % FileAccess.get_file_as_string("user://save.dat").strip_edges())
	var missing := FileAccess.open("user://missing.dat", FileAccess.READ)
	if missing != null:
		missing.close()
		lines.append("missing unexpectedly opened")
	else:
		lines.append("missing error=%s" % error_string(FileAccess.get_open_error()))

	var report := "\n".join(lines)
	print("[Godot] file access\n" + report)
	var label := Label.new()
	label.position = Vector2(24, 24)
	label.size = Vector2(432, 700)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.text = report
	add_child(label)
	var report_file := FileAccess.open("user://report.txt", FileAccess.WRITE)
	if report_file != null:
		report_file.store_string(report)
		report_file.close()
