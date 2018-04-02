
var previous_time;
var tid = -1;
var recording = false;
var playing = false;

var file = new AudioFile;

var get_wav_file = function(file, callback){
	file.updateBufferSize(file.length);

	var worker = new Worker("lib/recorderWorker.js");
	
	worker.postMessage({
		command: "init",
		config: {
			sampleRate: audio_context.sampleRate,
			numChannels: numChannels
		}
	});
	
	var buffer = [];
	for (var channel = 0; channel < numChannels; channel++){
		buffer.push(file.buffer.getChannelData(channel));
	}
	worker.postMessage({
		command: "record",
		buffer: buffer,
	});
	
	worker.postMessage({
		command: "exportWAV",
		type: "audio/wav",
	});
	
	worker.onmessage = function(e){
		callback(e.data);
	};
}

var download_wav_file = function(file){
	
	// FIXME: download click fails because of async
	// TODO: display a window with a link to download, maybe prompt for a filename
	// TODO: use Streams API to actually write in chunks where supported
	// (There's a WritableStream but I don't think there's been a sink specified for writing to a file)

	var gotWAV = function(blob){
		var a = document.createElement('a');
		a.href = (window.URL || window.webkitURL).createObjectURL(blob);
		a.download = file.name.replace(/(?:\.wav)?$/, ".wav");
		var click = document.createEvent("Event");
		click.initEvent("click", true, true);
		a.dispatchEvent(click);
	};

	get_wav_file(file, gotWAV);
	
};

var update = function(position_from_slider){
	document.title = file.name + " - Sound Recorder";
	if(position_from_slider != null){
		file.position = position_from_slider;
		
		file.audio.seek(file.position);
		if(playing){
			file.audio.play();
		}
	}else{
		if(playing){
			var delta_time = audio_context.currentTime - previous_time;
			previous_time = audio_context.currentTime;
			file.position += delta_time;
		}
		// (not sure the (file.position >= file.availLength) needs to be within if(recording || playing){})
		if(recording || playing){
			if(file.position >= file.availLength){
				file.position = file.availLength;
				stop();
			}
		}else{
			$stop.disable();
		}
		if(recording){
			file.length = Math.max(file.length, file.position);
		}
		if(file.length && !playing && !recording){
			$play.enable();
		}else{
			$play.disable();
		}
		$slider.slider("option", "max", file.availLength);
		$slider.slider("value", file.position);
	}
	
	$length.display(file.availLength);
	$position.display(file.position);
	$wave_display.display();
	
	if(file.length && file.position > 0){
		$seek_to_start.enable();
	}else{
		$seek_to_start.disable();
	}
	if(file.length && file.position + SLIDER_DUMBNESS < file.length){ // why doesn't the slider slide all the way to the max?
		$seek_to_end.enable();
	}else{
		$seek_to_end.disable();
	}
};

var record = function(){
	clearInterval(tid);
	
	$record.disable();
	$stop.enable();
	
	file.availLength = Math.max(file.length, file.position + 23.77);
	file.updateBufferSize(file.availLength);
	
	previous_time = audio_context.currentTime;
	tid = setInterval(update, 50);
	recording = true;
};

var stop = function(){
	clearInterval(tid);
	
	file.audio.pause();
	
	recording = false;
	playing = false;
	
	$stop.disable();
	if(input){ $record.enable(); }
	
	file.availLength = file.length;
	update();
};

var play = function(){
	clearInterval(tid);
	if(file.position >= file.length){
		file.position = 0;
	}
	file.audio.seek(file.position);
	file.audio.play();
	
	$play.disable();
	$stop.enable();
	
	playing = true;
	previous_time = audio_context.currentTime;
	tid = setInterval(update, 50);
	update();
};

var seek_to_start = function(){
	seek(0);
};

var seek_to_end = function(){
	seek(file.length);
};



var seek = function(t){
	file.position = t;
	file.audio.seek(file.position);
	if(playing){ file.audio.play(); }
	update();
};
var are_you_sure = function(fn){
	fn(); // "probably, right?"
	// TODO: dialog box!
};
var reset = function(){
	recording = false;
	playing = false;
	file = new AudioFile;
	update();
};
var read_audio_data = function(file, callback){
	var fileReader = new FileReader;
	fileReader.onload = function(){
		var arrayBuffer = this.result;
		audio_context.decodeAudioData(arrayBuffer, callback, function(){
			__log("Failed to read audio from file");
		});
	};
	fileReader.readAsArrayBuffer(file);
};
var open_file = function(original){
	read_audio_data(original, function(buffer){
		are_you_sure(function(){
			reset();
			file.original = original;
			file.name = original.name;
			file.setBuffer(buffer);
			update();
		});
	});
};



var file_new = function(){
	are_you_sure(reset);
};
var file_open = function(){
	$("<input type='file' accept='audio/*'>").click().change(function(e){
		open_file(this.files[0]);
	});
};
var can_revert_file = function(){
	return !!file.original;
};
var file_revert = function(){
	if(!file.original){ throw new Error("No original file"); }
	open_file(file.original);
};
var file_save_as = function(){
	if(file.length > 0){
		download_wav_file(file);
	}
};
var file_save = file_save_as;


var can_delete_before_current_position = function(){
	return file.position > 0;
};
var can_delete_after_current_position = function(){
	return file.position < file.length;
};
var delete_before_current_position = function(){
	var cut_position = file.position;
	file.crop(cut_position, file.length);
	seek(0);
};
var delete_after_current_position = function(){
	var cut_position = file.position;
	file.crop(0, cut_position);
	seek(cut_position);
};


var input;

$(function(){
	
	var gotStream = function(stream){
		input = audio_context.createMediaStreamSource(stream);
		__log("Media stream created.");
		
		input.connect($wave_display.analyser);
		input.connect(file.recorder);
		
		$record.enable();
	};
	var gotError = function(err){
		__log("No live audio input: " + err);
	};

	navigator.getUserMedia = (
		navigator.getUserMedia ||
		navigator.webkitGetUserMedia ||
		navigator.mozGetUserMedia ||
		navigator.msGetUserMedia
	);

	if (typeof navigator.mediaDevices.getUserMedia === 'undefined') {
		navigator.getUserMedia({
			audio: true
		}, gotStream, gotError);
	} else {
		navigator.mediaDevices.getUserMedia({
			audio: true
		}).then(gotStream).catch(gotError);
	}
	
	update();
	
});

$G.on("dragover", function(e){
	e.preventDefault();
});
$G.on("drop", function(e){
	e.preventDefault();
	var files = e.originalEvent.dataTransfer.files;
	var file = files[0];
	if(file){
		open_file(file);
	}
});