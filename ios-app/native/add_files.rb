# Ajoute les fichiers Swift au projet Xcode et utilise MainViewController.
require 'xcodeproj'
project = Xcodeproj::Project.open('ios/App/App.xcodeproj')
target = project.targets.find { |t| t.name == 'App' }
group = project.main_group['App']
%w[DictaPlugin.swift MainViewController.swift].each do |name|
  next if group.files.any? { |f| f.path == name }
  target.add_file_references([group.new_reference(name)])
end
project.save
puts 'Fichiers natifs ajoutés'
